"""
Полный парсер всех отзывов с публичной страницы Яндекс.Карт через Playwright.

ПРЕИМУЩЕСТВА перед scrape_yandex_reviews.py (sprav-админка):
  - Не нужны cookies/авторизация (публичная страница).
  - Полный текст БЕЗ обрезок «… читать далее».
  - Все 3500+ отзывов, не только первые 600.
  - Точные оценки (1-5) из schema.org разметки.

Принцип:
  1) Открываем https://yandex.ru/maps/org/{ORG_ID}/reviews/
  2) Скроллим список отзывов вниз до конца (Maps подгружает по 50 при скролле).
  3) После полной загрузки распарсиваем все .business-review-view блоки.
  4) Сохраняем в _ya_cache/maps_reviews.json.

Использование:
  python -X utf8 -u scrape_yandex_maps_reviews.py
  python -X utf8 -u scrape_yandex_maps_reviews.py --max 500           # ограничить
  python -X utf8 -u scrape_yandex_maps_reviews.py --keywords жёлт*,курьер*

ВНИМАНИЕ:
  Скрипт скроллит в headed (видимом) браузере — Yandex иногда блокирует чисто
  headless. Если зависает, попробуйте --headless и --slow.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, TimeoutError as PWTimeout


HERE = Path(__file__).parent.resolve()
CACHE_DIR = HERE / '_ya_cache'
ORG_ID = '1693656993'
OUT_JSON = CACHE_DIR / 'maps_reviews.json'
OUT_HTML_SNAPSHOT = CACHE_DIR / 'maps_after_scroll.html'


def setup_browser(p, headless: bool):
    browser = p.chromium.launch(
        headless=headless,
        args=['--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
    )
    ctx = browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        locale='ru-RU',
        viewport={'width': 1280, 'height': 900},
    )
    return browser, ctx


def expected_total(page: Page) -> int | None:
    """Берём totalReviewCount из schema.org или из заголовка."""
    try:
        meta = page.locator('meta[itemprop="reviewCount"]').first.get_attribute('content', timeout=3000)
        if meta and meta.isdigit():
            return int(meta)
    except PWTimeout:
        pass
    # Заголовок «Отзывы 3582»
    try:
        header = page.locator('.business-header-rating-view__text, .tabs-select-view__title').all_text_contents()
        for h in header:
            m = re.search(r'(\d{2,})', h.replace(' ', '').replace(' ', ''))
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return None


def collect_visible_reviews(page: Page) -> list[dict]:
    """Парсим всё, что сейчас в DOM. Используется инкрементально между скроллами."""
    js = r'''() => {
        const out = [];
        const root = document.querySelectorAll('.business-review-view');
        for (const r of root) {
            const authorEl = r.querySelector('[itemprop="author"] [itemprop="name"]');
            const dateEl   = r.querySelector('meta[itemprop="datePublished"]');
            const ratingEl = r.querySelector('meta[itemprop="ratingValue"]');
            let textEl     = r.querySelector('[itemprop="reviewBody"], [itemprop="description"], .business-review-view__body-text, .spoiler-view__text');
            if (!textEl)   textEl = r.querySelector('.business-review-view__body');
            const text     = textEl ? textEl.textContent.replace(/\s+/g,' ').trim() : '';
            const reply    = r.querySelector('.business-review-comment-content__bubble, .business-review-comment-bubble__text');
            // Уникальный ключ для дедупликации — пытаемся взять href автора + дату
            const aHref    = r.querySelector('[itemprop="author"] a')?.getAttribute('href') || '';
            const aName    = authorEl ? authorEl.textContent.trim() : '';
            const date     = dateEl ? dateEl.getAttribute('content') : '';
            // Ключ: автор (href + name) + дата + первые 50 символов нормализованного текста.
            // Без текста — анонимы за одну дату мерджились.
            // С полным текстом — дубликаты при разном обрезании не находились.
            // Компромисс: первые 50 chars (мало меняются от обрезания, разные тексты ловятся).
            const tsig     = text.toLowerCase().replace(/\s+/g,' ').replace(/[…]/g,'').trim().slice(0,50);
            const key      = `${aHref}|${aName}|${date}|${tsig}`;
            out.push({
                _key:   key,
                author: authorEl ? authorEl.textContent.trim() : null,
                author_url: aHref || null,
                date:   date,
                rating: ratingEl ? parseInt(ratingEl.getAttribute('content'), 10) : null,
                text:   text,
                reply:  reply ? reply.textContent.replace(/\s+/g,' ').trim() : null,
            });
        }
        return out;
    }'''
    return page.evaluate(js)


def click_visible_expand_buttons(page: Page) -> int:
    """Кликаем все видимые «развернуть» в текущем viewport."""
    js = r'''() => {
        let n = 0;
        const selectors = [
            '.business-review-view__expand',
            '.business-review-view__expand-link',
            '.spoiler-view__expand',
            '.business-review-view__expand-button',
        ];
        for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
                try { el.click(); n++; } catch(e){}
            }
        }
        return n;
    }'''
    try:
        return page.evaluate(js)
    except Exception:
        return 0


def scroll_and_collect(page: Page, target_count: int | None,
                       max_iters: int = 2000, idle_threshold: int = 60) -> dict[str, dict]:
    """Инкрементальный сбор: скроллим список, после каждого скролла парсим
    видимые отзывы и кладём в общий dict по _key (для дедупа из-за виртуального скролла).

    Возвращает dict {key: review_dict}.
    """
    sel = '.business-review-view'
    page.wait_for_selector(sel, timeout=20000)

    collected: dict[str, dict] = {}
    last_total = 0
    idle_streak = 0

    for i in range(max_iters):
        # Развернуть всё что обрезано в текущем viewport
        click_visible_expand_buttons(page)
        page.wait_for_timeout(50)

        # Снимем то, что сейчас в DOM
        batch = collect_visible_reviews(page)
        for r in batch:
            k = r['_key']
            existing = collected.get(k)
            # обновляем только если новый текст длиннее (после expand)
            if not existing or len(r.get('text','')) > len(existing.get('text','')):
                collected[k] = r

        total = len(collected)

        if target_count and total >= target_count:
            logging.info('reached target %d at iter %d', target_count, i)
            return collected

        if total == last_total:
            idle_streak += 1
            if idle_streak >= idle_threshold:
                logging.info('idle %d iters at %d unique reviews, stopping', idle_streak, total)
                return collected
        else:
            idle_streak = 0
            last_total = total

        # Реальный mouse.wheel внутри панели отзывов (Maps игнорирует scrollTop).
        # Координаты — центр sidebar (~200, 500), wheel вниз на 2000px.
        try:
            box = page.evaluate('''() => {
                const items = document.querySelectorAll('.business-review-view');
                if (!items.length) return null;
                const r = items[items.length-1].getBoundingClientRect();
                return {x: r.x + r.width/2, y: r.y + r.height/2};
            }''')
            if box:
                page.mouse.move(box['x'], box['y'])
                page.mouse.wheel(0, 3000)
            else:
                page.mouse.move(200, 500)
                page.mouse.wheel(0, 3000)
        except Exception as e:
            logging.debug('wheel err: %s', e)
        # Бэкап — и scrollTop тоже
        page.evaluate('''() => {
            for (const c of document.querySelectorAll('.scroll__container')) {
                c.scrollTop = c.scrollHeight;
            }
        }''')
        # Если стуим на месте долго — даём больше времени на подгрузку (rate-limit от Yandex)
        wait_ms = 600 if idle_streak < 5 else 2000
        page.wait_for_timeout(wait_ms)

        if i % 10 == 0:
            logging.info('iter %d: %d unique reviews collected%s (DOM has %d)',
                         i, total, f' / {target_count}' if target_count else '',
                         len(batch))
    return collected


def filter_by_keywords(reviews: list[dict], keywords: list[str]) -> list[dict]:
    patterns = []
    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        pat = re.escape(kw).replace(r'\*', r'\w*')
        patterns.append(re.compile(pat, re.IGNORECASE))
    if not patterns:
        return reviews
    matched = []
    for r in reviews:
        for p in patterns:
            if r.get('text') and p.search(r['text']):
                r['_matched'] = sorted({m.group(0).lower() for m in p.finditer(r['text'])})
                matched.append(r)
                break
    return matched


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--headless', action='store_true', help='headless (по умолчанию видимый)')
    ap.add_argument('--max', type=int, default=None, help='ограничить число отзывов (для теста)')
    ap.add_argument('--keywords', default=None,
                    help='Через запятую: «жёлт*,курьер*,фудкорт*»')
    ap.add_argument('--no-expand', action='store_true', help='не кликать «развернуть»')
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s')
    CACHE_DIR.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser, ctx = setup_browser(p, headless=args.headless)
        page = ctx.new_page()

        # Геолокация Екатеринбург — чтобы Yandex не редиректил на .com
        cookies_to_set = [
            {'name': 'yandex_gid', 'value': '54', 'domain': '.yandex.ru', 'path': '/'},
            {'name': 'yp', 'value': '2086918399.ygu.1', 'domain': '.yandex.ru', 'path': '/'},
        ]
        # Если есть auth cookies в _ya_cookies.txt — добавим их (увеличивает лимит)
        cookies_file = HERE / '_ya_cookies.txt'
        if cookies_file.exists():
            cookie_str = cookies_file.read_text(encoding='utf-8').strip()
            for part in cookie_str.split(';'):
                if '=' in part:
                    k, _, v = part.strip().partition('=')
                    cookies_to_set.append({'name': k.strip(), 'value': v.strip(),
                                           'domain': '.yandex.ru', 'path': '/'})
            logging.info('loaded %d cookies from %s', len(cookies_to_set), cookies_file.name)
        ctx.add_cookies(cookies_to_set)

        # Yandex Maps отдаёт максимум ~600 отзывов на анонимного пользователя
        # для одной сортировки. Проходим по нескольким сортировкам и объединяем.
        # Параметр URL: ?reviews[sortType]=... Yandex также поддерживает:
        #   by_time          - новые сначала (default)
        #   by_synthetic_rating_asc / _desc  - сортировка по оценке
        # А также можно открывать прямые URL вида ?ll=...&z=...&tab=reviews
        rankings = [
            ('reviews-newest',   'https://yandex.ru/maps/org/{org}/reviews/'),
            ('rating-lowest',    'https://yandex.ru/maps/org/{org}/reviews/?reviews%5BpublicId%5D=&reviews%5BsortType%5D=by_synthetic_rating_asc'),
            ('rating-highest',   'https://yandex.ru/maps/org/{org}/reviews/?reviews%5BpublicId%5D=&reviews%5BsortType%5D=by_synthetic_rating_desc'),
        ]

        all_reviews: dict[str, dict] = {}
        for label, url_tpl in rankings:
            url = url_tpl.format(org=ORG_ID)
            logging.info('=== [%s] opening %s', label, url)
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            try:
                page.wait_for_selector('.business-review-view', timeout=30000)
            except PWTimeout:
                logging.warning('no reviews loaded for %s', label)
                continue

            total = expected_total(page)
            target = args.max or total
            logging.info('[%s] expected %s', label, total)

            batch = scroll_and_collect(page, target_count=target)
            for k, r in batch.items():
                existing = all_reviews.get(k)
                if not existing or len(r.get('text','')) > len(existing.get('text','')):
                    all_reviews[k] = r
            logging.info('[%s] +%d new, total unique: %d', label, len(batch), len(all_reviews))
            if args.max and len(all_reviews) >= args.max:
                break

        reviews = list(all_reviews.values())
        for r in reviews:
            r.pop('_key', None)
        reviews.sort(key=lambda r: r.get('date') or '', reverse=True)
        logging.info('collected %d unique reviews total', len(reviews))

        # Сохраним HTML на всякий случай для диагностики
        try:
            OUT_HTML_SNAPSHOT.write_text(page.content(), encoding='utf-8')
        except Exception:
            pass

        OUT_JSON.write_text(json.dumps(reviews, ensure_ascii=False, indent=2),
                            encoding='utf-8')
        logging.info('saved → %s', OUT_JSON)

        if args.keywords:
            kws = [k.strip() for k in args.keywords.split(',') if k.strip()]
            matched = filter_by_keywords(reviews, kws)
            print(f'\n=== Найдено по [{", ".join(kws)}]: {len(matched)} ===\n')
            for r in matched:
                print(f'### {r.get("date","?")[:10]} · {r.get("rating","?")}/5 · {r.get("author")}')
                print(f'    {r.get("text","")}')
                print(f'    matched: {r.get("_matched")}')
                print()

        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
