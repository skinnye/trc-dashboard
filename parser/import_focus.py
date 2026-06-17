"""
Импорт поведенческих метрик из выгрузки Focus (касса/чеки) в focus_monthly.

ВАЖНО: товарооборот/продажи из Focus НЕ берём (у нас свой ТО из листа
«НОВАЯ»). Берём только метрики, которых у нас нет в чистом виде:
  • Средний чек, ₽            → avg_check
  • Количество чеков, pcs      → receipts
  • Продажи (с НДС)/м²         → sales_per_m2
  • Возвраты (с НДС), иное, ₽   → returns

Выгрузка Focus — лист «Sheet1», структура:
  r5: ['Метрика', 'Объект', <дата месяца>, <дата>, ...]   (помесячные колонки)
  r6+: одна строка = (метрика, магазин), значения по месяцам.

Названия магазинов в Focus в другом регистре/транслите, чем у нас
(KFC↔КФС, Zolla↔Золла, T2↔Теле2). Матчим к нашим store_name из
turnover_monthly транслитерацией + ручными алиасами + fuzzy. Несматченные
сохраняем тоже (store_name=NULL) — чтобы видеть, кого не привязали.

Запуск:
  python import_focus.py
  python import_focus.py --file "путь/к/выгрузке.xlsx"
"""
from __future__ import annotations

import argparse
import glob
import logging
import os
import re
import sqlite3
import sys
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print('Нужен openpyxl: pip install openpyxl', file=sys.stderr)
    sys.exit(2)

HERE = Path(__file__).parent.resolve()
DB_PATH = Path(os.environ.get('DASHBOARD_DB', str(HERE.parent / 'dashboard.db')))
LOG_DIR = HERE / 'logs'
LOG_DIR.mkdir(exist_ok=True)

# Метрика Focus → колонка в focus_monthly. Товарооборот/продажи намеренно нет.
METRIC_MAP = {
    'Средний чек, ₽':                 'avg_check',
    'Количество чеков, pcs':           'receipts',
    'Продажи (с НДС)/м², currency/m²': 'sales_per_m2',
    'Возвраты (с НДС), иное, ₽':       'returns',
}

SCHEMA_SQL = '''
CREATE TABLE IF NOT EXISTS focus_monthly (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store_name    TEXT,            -- наш store_name (как в turnover_monthly), NULL если не сматчен
  focus_name    TEXT NOT NULL,   -- оригинальное имя из выгрузки Focus
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  avg_check     REAL,
  receipts      REAL,
  sales_per_m2  REAL,
  returns       REAL,
  source_file   TEXT NOT NULL,
  imported_at   TEXT NOT NULL,
  UNIQUE(focus_name, year, month)
);
CREATE INDEX IF NOT EXISTS idx_focus_store      ON focus_monthly(store_name);
CREATE INDEX IF NOT EXISTS idx_focus_year_month ON focus_monthly(year, month);
'''

TR = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j',
      'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
      'х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}

# Ручные алиасы focus_name → наш store_name (где транслит/fuzzy не справляется).
ALIAS = {
    'KFC': 'КФС',
    'T2': 'Теле2',
    'MAMA restaurant (Япона мама)': 'Мама',
    'Киноцентр Прада': 'Прада3D',
}


def norm(s: str) -> str:
    s = re.sub(r'\(.*?\)', '', s.lower())
    s = ''.join(TR.get(ch, ch) for ch in s)
    return re.sub(r'[^a-z0-9]', '', s)


def best_match(focus_name: str, db_stores: list[str]) -> str | None:
    if focus_name in ALIAS and ALIAS[focus_name] in db_stores:
        return ALIAS[focus_name]
    if not db_stores:
        return None
    best = max(db_stores, key=lambda d: SequenceMatcher(None, norm(focus_name), norm(d)).ratio())
    ratio = SequenceMatcher(None, norm(focus_name), norm(best)).ratio()
    return best if ratio >= 0.70 else None


def cell_to_float(v) -> float | None:
    if v is None or v == '':
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None
    s = str(v).strip().replace(',', '.').replace('\xa0', '').replace(' ', '')
    try:
        return float(s)
    except ValueError:
        return None


def setup_logging() -> None:
    log_file = LOG_DIR / f'focus_{datetime.now():%Y-%m-%d_%H-%M}.log'
    logging.basicConfig(
        level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file, encoding='utf-8'), logging.StreamHandler(sys.stdout)],
        force=True,
    )


def find_default_file() -> str | None:
    # Выгрузка Focus обычно лежит в корне проекта: «ТРЦ ...Основной... .xlsx».
    candidates = glob.glob(str(HERE.parent / 'ТРЦ Академический*Основной*.xlsx'))
    candidates += glob.glob(str(HERE.parent / '*Основной*.xlsx'))
    return candidates[0] if candidates else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', default=None, help='Путь к выгрузке Focus (.xlsx)')
    ap.add_argument('--sheet', default='Sheet1')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    setup_logging()
    path = args.file or find_default_file()
    if not path or not Path(path).exists():
        logging.error('Файл выгрузки Focus не найден. Укажите --file. Искал в корне проекта.')
        return 2
    logging.info('Импорт Focus. Файл: %s', path)

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[args.sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Шапка с месяцами — первая строка, где col1='Метрика'.
    hdr_idx = next((i for i, r in enumerate(rows) if r and r[0] == 'Метрика'), None)
    if hdr_idx is None:
        logging.error('Не нашёл строку-шапку с «Метрика».')
        return 2
    header = rows[hdr_idx]
    mcols = [(j, c.year, c.month) for j, c in enumerate(header[2:], start=2) if isinstance(c, datetime)]
    logging.info('Месячных колонок: %d (%s..%s)', len(mcols),
                 f'{mcols[0][1]}-{mcols[0][2]:02d}', f'{mcols[-1][1]}-{mcols[-1][2]:02d}')

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_SQL)
    db_stores = [r[0] for r in conn.execute('SELECT DISTINCT store_name FROM turnover_monthly')]

    # Собираем по focus_name: {(year,month): {col: value}}
    per_store: dict[str, dict[tuple[int, int], dict[str, float | None]]] = {}
    for row in rows[hdr_idx + 1:]:
        metric, obj = row[0], row[1]
        if not obj or metric not in METRIC_MAP:
            continue
        col = METRIC_MAP[metric]
        store_bucket = per_store.setdefault(obj, {})
        for (j, y, m) in mcols:
            v = cell_to_float(row[j])
            if v is None:
                continue
            store_bucket.setdefault((y, m), {})[col] = v

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    matched_n = unmatched_n = wrote = 0
    unmatched_names = []

    for focus_name, months in per_store.items():
        store_name = best_match(focus_name, db_stores)
        if store_name:
            matched_n += 1
        else:
            unmatched_n += 1
            unmatched_names.append(focus_name)
        for (y, m), vals in months.items():
            if all(vals.get(c) is None for c in METRIC_MAP.values()):
                continue
            wrote += 1
            if args.dry_run:
                continue
            conn.execute(
                '''INSERT INTO focus_monthly
                   (store_name, focus_name, year, month, avg_check, receipts, sales_per_m2, returns, source_file, imported_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(focus_name, year, month) DO UPDATE SET
                     store_name=excluded.store_name, avg_check=excluded.avg_check,
                     receipts=excluded.receipts, sales_per_m2=excluded.sales_per_m2,
                     returns=excluded.returns, source_file=excluded.source_file,
                     imported_at=excluded.imported_at''',
                (store_name, focus_name, y, m, vals.get('avg_check'), vals.get('receipts'),
                 vals.get('sales_per_m2'), vals.get('returns'), str(path), now),
            )

    if not args.dry_run:
        conn.commit()
    conn.close()

    logging.info('Готово. Магазинов Focus: %d (сматчено %d, без матча %d). Записей помесячно: %d.',
                 matched_n + unmatched_n, matched_n, unmatched_n, wrote)
    if unmatched_names:
        logging.info('Без матча к нашим store_name: %s', ', '.join(sorted(unmatched_names)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
