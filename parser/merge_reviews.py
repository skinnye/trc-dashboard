"""
Объединяет отзывы из двух источников в единый JSON:
  1) parser/_ya_cache/maps_reviews.json — публичная Yandex.Карты (Playwright)
  2) parser/_ya_cache/reviews.json      — админ-страница sprav.yandex.ru

Источники дают пересекающиеся, но не идентичные множества:
  - Maps: больше отзывов, полный текст, точные оценки 1-5 из schema.org,
          но скрывает удалённые/спорные отзывы.
  - Sprav: видит ВСЕ отзывы для админа (включая скрытые), но
          текст обрезается на ~225 символов.

Результат: parser/_ya_cache/reviews_merged.json — массив отзывов с полями:
  date, rating, author, text, source ('maps' | 'sprav' | 'both')
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent.resolve()
CACHE = HERE / '_ya_cache'

# Месяцы для парсинга «12 мая 2026» — sprav формат
MONTH_MAP = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
    'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
    'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
}


def normalize_date(d: str | None) -> str | None:
    """ISO YYYY-MM-DD или None. Принимает ISO с временем (Maps) или 'YYYY-MM-DD' (sprav)."""
    if not d:
        return None
    return d[:10] if len(d) >= 10 else None


def normalize_text(t: str | None) -> str:
    """Нормализуем для сравнения дубликатов."""
    if not t:
        return ''
    t = re.sub(r'\s+', ' ', t).strip().lower()
    # убираем '… читать далее', '…ещё' и т.д.
    t = re.sub(r'…\s*(ещё|читать\s*(полностью|далее)?)?\s*$', '', t).strip()
    t = re.sub(r'\.{3,}\s*$', '', t).strip()
    return t


def signature(rev: dict) -> str:
    """Подпись для дедупа: автор (lower) + дата + первые 40 chars текста."""
    a = (rev.get('author') or '').strip().lower()
    d = normalize_date(rev.get('date'))
    t = normalize_text(rev.get('text'))[:40]
    return f'{a}||{d}||{t}'


def load_maps() -> list[dict]:
    p = CACHE / 'maps_reviews.json'
    if not p.exists():
        return []
    raw = json.loads(p.read_text(encoding='utf-8'))
    out = []
    for r in raw:
        out.append({
            'date':   normalize_date(r.get('date')),
            'rating': r.get('rating'),
            'author': r.get('author'),
            'text':   (r.get('text') or '').strip(),
            'reply':  r.get('reply'),
            'source': 'maps',
        })
    return out


def load_sprav() -> list[dict]:
    p = CACHE / 'reviews.json'
    if not p.exists():
        return []
    raw = json.loads(p.read_text(encoding='utf-8'))
    out = []
    for r in raw:
        out.append({
            'date':   normalize_date(r.get('date')),
            'rating': r.get('rating'),  # обычно None в sprav (звёзды не парсились)
            'author': r.get('author'),
            'text':   (r.get('text') or '').strip(),
            'reply':  None,
            'source': 'sprav',
            'page':   r.get('page'),
        })
    return out


def merge(maps: list[dict], sprav: list[dict]) -> list[dict]:
    by_sig: dict[str, dict] = {}
    for r in maps + sprav:
        sig = signature(r)
        existing = by_sig.get(sig)
        if not existing:
            by_sig[sig] = r
            continue
        # Сливаем
        combined = dict(existing)
        # Источник
        if existing['source'] != r['source']:
            combined['source'] = 'both'
        # Текст — берём длиннее
        if len(r.get('text','')) > len(existing.get('text','')):
            combined['text'] = r['text']
        # Рейтинг — берём из maps (там точный)
        if not combined.get('rating') and r.get('rating'):
            combined['rating'] = r['rating']
        # Reply
        if not combined.get('reply') and r.get('reply'):
            combined['reply'] = r['reply']
        # Page из sprav
        if not combined.get('page') and r.get('page'):
            combined['page'] = r['page']
        by_sig[sig] = combined

    out = list(by_sig.values())
    out.sort(key=lambda x: x.get('date') or '', reverse=True)
    return out


def report(merged: list[dict]) -> None:
    print(f'\n=== summary ===')
    print(f'total: {len(merged)}')
    src = Counter(r['source'] for r in merged)
    print(f'by source: {dict(src)}')
    yrs = Counter((r['date'] or '????')[:4] for r in merged)
    print(f'by year:   {dict(sorted(yrs.items()))}')
    rt = Counter(r.get('rating') for r in merged)
    print(f'by rating: {dict(sorted((k or 0, v) for k,v in rt.items()))}')

    KW = {
        'жёлт*':   r'жёлт\w*',
        'желт*':   r'желт\w*',
        'рюкзак':  r'рюкзак\w*',
        'курьер':  r'курьер\w*',
        'доставщ': r'доставщ\w*',
        'самокат': r'самокат\w*',
        'фуд-корт': r'фуд[\- ]?корт',
        'пвз':     r'\bпвз\b',
    }
    print('\n=== keyword hits ===')
    for label, pat in KW.items():
        n = sum(1 for r in merged if r.get('text') and re.search(pat, r['text'], re.I))
        print(f'  {label:10s}: {n}')


def main() -> int:
    maps = load_maps()
    sprav = load_sprav()
    print(f'maps:  {len(maps)}')
    print(f'sprav: {len(sprav)}')

    merged = merge(maps, sprav)
    out_path = CACHE / 'reviews_merged.json'
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'saved → {out_path}')

    report(merged)
    return 0


if __name__ == '__main__':
    sys.exit(main())
