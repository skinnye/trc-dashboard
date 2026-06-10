"""
Парсер отзывов из админки Яндекс.Бизнеса (sprav.yandex.ru).

URL шаблон:
  https://yandex.ru/sprav/{ORG_ID}/p/edit/reviews/?ranking=by_rating_asc&page={N}&type=company

Cookies лежат в parser/_ya_cookies.txt (gitignore). Берутся из браузера один раз
через DevTools → Network → Copy as cURL и извлекаются вручную в файл.

Использование:
  python scrape_yandex_reviews.py                 # всё (1..30 страниц)
  python scrape_yandex_reviews.py --pages 1-5     # подмножество
  python scrape_yandex_reviews.py --keywords жёлт,рюкзак,курьер  # сразу фильтр

Результат:
  parser/_ya_cache/reviews.json — все отзывы (объединение всех страниц)
  parser/_ya_cache/page{N}.html  — сырые HTML страницы (кэш, чтобы не перекачивать)
  stdout — отчёт по найденному (если задан --keywords)
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Iterable

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print('Нужно: pip install requests beautifulsoup4', file=sys.stderr)
    sys.exit(2)


HERE = Path(__file__).parent.resolve()
COOKIES_FILE = HERE / '_ya_cookies.txt'
CACHE_DIR    = HERE / '_ya_cache'
ORG_ID       = '1693656993'

# Месяцы для парсинга дат «12 мая 2026»
MONTH_MAP = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
    'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
    'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
}
DATE_RE = re.compile(r'(\d{1,2})\s+([а-яё]+)\s+(20\d{2})', re.IGNORECASE)


def parse_date(s: str) -> str | None:
    """'12 мая 2026' → '2026-05-12' или None."""
    m = DATE_RE.search(s)
    if not m:
        return None
    day, month_word, year = m.group(1), m.group(2).lower(), m.group(3)
    month = MONTH_MAP.get(month_word)
    if not month:
        return None
    return f'{year}-{month:02d}-{int(day):02d}'


def build_session() -> requests.Session:
    if not COOKIES_FILE.exists():
        print(f'Нет файла cookies: {COOKIES_FILE}', file=sys.stderr)
        sys.exit(2)
    cookie_str = COOKIES_FILE.read_text(encoding='utf-8').strip()
    s = requests.Session()
    # Парсим cookie-строку формата 'a=1; b=2; c=3' в dict
    for part in cookie_str.split(';'):
        if '=' in part:
            k, _, v = part.strip().partition('=')
            s.cookies.set(k.strip(), v.strip(), domain='.yandex.ru')
    s.headers.update({
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': f'https://yandex.ru/business/priority/company/{ORG_ID}/campaigns',
    })
    return s


def fetch_page(session: requests.Session, page: int, force: bool = False) -> str:
    """Скачивает страницу с кэшем в _ya_cache/pageN.html."""
    cache = CACHE_DIR / f'page{page}.html'
    if cache.exists() and not force:
        return cache.read_text(encoding='utf-8')
    CACHE_DIR.mkdir(exist_ok=True)
    url = (f'https://yandex.ru/sprav/{ORG_ID}/p/edit/reviews/'
           f'?ranking=by_rating_asc&page={page}&type=company')
    r = session.get(url, timeout=30)
    r.raise_for_status()
    cache.write_text(r.text, encoding='utf-8')
    return r.text


def extract_rating(review_div) -> int | None:
    """Количество звёзд в блоке отзыва.

    Yandex обычно рендерит шкалу из 5 элементов, где «активные» имеют
    отдельный класс. Эвристика: считаем число <svg> или <span> внутри
    .Review-Stars / .Stars / role=img с признаком заполненности.
    Если шкала не найдена — None.
    """
    # Подход 1: класс с «star» и счётчиком «active/filled»
    for star_box in review_div.find_all(class_=re.compile(r'[Ss]tars?|[Rr]ating')):
        # Активные могут быть распознаны по 'active' / 'filled' / 'on'
        active = star_box.find_all(class_=re.compile(r'active|filled|_on|--on|highlighted', re.IGNORECASE))
        if active:
            return min(5, len(active))
        # Если есть элементы со aria-hidden=false и/или цветной svg
        svgs = star_box.find_all('svg')
        if svgs:
            return len([s for s in svgs if 'active' in ' '.join(s.get('class') or []).lower()
                        or s.get('fill', '').lower() not in ('', 'none')])
    # Подход 2: title или aria-label со «звезд X»
    aria = review_div.find(attrs={'aria-label': re.compile(r'\d')})
    if aria:
        m = re.search(r'(\d)', aria.get('aria-label', ''))
        if m:
            return int(m.group(1))
    return None


def extract_text(review_div) -> str:
    """Полный текст отзыва из .Review-Text. Сворачиваем «читать»-плашки."""
    text_div = review_div.find(class_=re.compile(r'Review-Text|review_text|ReviewText'))
    if text_div is None:
        return ''
    txt = text_div.get_text(' ', strip=True)
    # Часто в конце: «... читать» или «… читать полностью» — убираем
    txt = re.sub(r'\s*(читать(\s+полностью)?|свернуть)\s*$', '', txt, flags=re.IGNORECASE).strip()
    return txt


def extract_author(review_div) -> str | None:
    # Первый div/span до .Review-Text часто содержит имя
    for cls_re in [r'Review-?Author', r'Review-?User', r'Review-?Name']:
        el = review_div.find(class_=re.compile(cls_re))
        if el:
            return el.get_text(' ', strip=True) or None
    return None


def parse_reviews_from_html(html: str, page: int) -> list[dict]:
    soup = BeautifulSoup(html, 'html.parser')
    out: list[dict] = []
    for rev in soup.find_all('div', class_='Review'):
        full_text = rev.get_text(' ', strip=True)
        date_iso = parse_date(full_text)
        text = extract_text(rev)
        if not text:
            continue
        out.append({
            'page':   page,
            'author': extract_author(rev),
            'date':   date_iso,
            'date_raw': (DATE_RE.search(full_text) or [None])[0],
            'rating': extract_rating(rev),
            'text':   text,
        })
    return out


def fetch_all(session: requests.Session, pages: Iterable[int],
              force: bool = False, delay: float = 1.5) -> list[dict]:
    all_reviews: list[dict] = []
    for p in pages:
        try:
            html = fetch_page(session, p, force=force)
        except Exception as e:
            logging.error('page %d: %s', p, e)
            continue
        revs = parse_reviews_from_html(html, p)
        logging.info('page %d: %d reviews', p, len(revs))
        all_reviews.extend(revs)
        time.sleep(delay)
    return all_reviews


def filter_by_keywords(reviews: list[dict], keywords: list[str]) -> list[dict]:
    """Простой text search — все ключевые слова через ИЛИ.
    Поддерживает звёздочки на конце как wildcards (через regex)."""
    patterns = []
    for kw in keywords:
        pat = kw.strip()
        if not pat:
            continue
        # 'желт*' → 'желт\w*'
        pat = re.escape(pat).replace(r'\*', r'\w*')
        patterns.append(re.compile(pat, re.IGNORECASE))
    if not patterns:
        return reviews
    matched: list[dict] = []
    for r in reviews:
        for p in patterns:
            if p.search(r['text']):
                r['_matched'] = list({m.group(0).lower() for m in p.finditer(r['text'])})[:5]
                matched.append(r)
                break
    return matched


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', default='1-30',
                    help='Диапазон страниц: 1-30 или 5,7,12')
    ap.add_argument('--force', action='store_true',
                    help='Игнорировать кэш _ya_cache/pageN.html, заново скачать')
    ap.add_argument('--keywords', default=None,
                    help='Через запятую, для отчёта. Поддерживает *: «жёлт*,рюкзак»')
    ap.add_argument('--delay', type=float, default=1.5,
                    help='Задержка между страницами, сек')
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')

    # Разбор диапазона страниц
    pages: list[int] = []
    for part in args.pages.split(','):
        if '-' in part:
            a, b = part.split('-')
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))

    session = build_session()
    reviews = fetch_all(session, pages, force=args.force, delay=args.delay)
    logging.info('total reviews: %d', len(reviews))

    CACHE_DIR.mkdir(exist_ok=True)
    out = CACHE_DIR / 'reviews.json'
    out.write_text(json.dumps(reviews, ensure_ascii=False, indent=2), encoding='utf-8')
    logging.info('saved → %s', out)

    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(',') if k.strip()]
        matched = filter_by_keywords(reviews, keywords)
        print(f'\n=== Найдено отзывов с упоминаниями [{", ".join(keywords)}]: {len(matched)} ===\n')
        for r in matched:
            print(f'### {r.get("date") or r.get("date_raw")} · оценка {r.get("rating") or "?"}/5 · стр. {r["page"]}')
            print(f'    {r["text"]}')
            print(f'    Матч: {r.get("_matched", [])}')
            print()

    return 0


if __name__ == '__main__':
    sys.exit(main())
