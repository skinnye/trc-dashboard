"""
Еженедельный сборщик данных 2GIS для дашборда.

Что делает:
  1. Читает справочник категорий из ext_categories (активных).
  2. Для каждой категории вызывает CLI parser-2gis с её search_url.
  3. Парсит JSON-выгрузку, апсёртит организации в ext_orgs (по ключу
     'категория|название|адрес' в нижнем регистре), пишет метрики в
     ext_snapshots с привязкой к run_id.
  4. Запись о прогоне ведёт в ext_runs (started_at, finished_at, status,
     categories_done, total_orgs). При повторном прогоне — НЕ создаёт
     дубликатов организаций, только новые снапшоты.

Запуск:
  python scrape_2gis.py                  # все активные категории
  python scrape_2gis.py --limit 10       # только первые 10 (для теста)
  python scrape_2gis.py --category 5     # только одна категория
  python scrape_2gis.py --delay 60       # задержка между категориями (сек)

Лог:
  parser/logs/YYYY-MM-DD_HH-MM.log
  Сырой JSON парсера на каждую категорию: parser/logs/raw_<run>_<cat>.json

Перед первым запуском:
  cd parser
  pip install -r requirements.txt
  python -m playwright install chromium    # для parser-2gis нужен Chromium

Расписание (Windows Task Scheduler):
  Программа: C:\\Path\\To\\Python\\python.exe
  Аргументы: "C:\\Users\\Князева\\Desktop\\TRC_tools\\parser\\scrape_2gis.py"
  Триггер:   еженедельно, суббота 03:00
  Запускать с наивысшими правами — нужен доступ к Chromium.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# ── Конфигурация ──────────────────────────────────────────────────────────
HERE = Path(__file__).parent.resolve()

# По умолчанию БД лежит на уровень выше (рядом с web/). Переопределяется
# переменной окружения DASHBOARD_DB.
DB_PATH = Path(os.environ.get('DASHBOARD_DB', str(HERE.parent / 'dashboard.db')))

LOG_DIR = HERE / 'logs'
LOG_DIR.mkdir(exist_ok=True)


# ── Утилиты ───────────────────────────────────────────────────────────────
def now_iso() -> str:
    """Локальное время в формате YYYY-MM-DD HH:MM:SS — совпадает с тем,
    что пишет Next.js (см. db.ts:localIsoDateTime)."""
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def dedupe_key(category: str, name: str, address: str) -> str:
    """Тот же ключ дедупа, что и в импортёре Excel (web/src/lib/external-import.ts).
    Без него парсер создаст параллельные orgs, не сматчившиеся с импортированными."""
    s = f'{category}|{name}|{address}'.strip().lower()
    return re.sub(r'\s+', ' ', s)


def normalize_search_url(url: str) -> str:
    """URL'ы из Excel имеют формат '.../search/X/filters/bound?m=lng,lat/zoom'.
    parser-2gis такой `m=...` не понимает — 2GIS Catalog API ругается:
    'Bound is incorrect. Set viewpoint1 to left top corner and viewpoint2
    to right bottom corner.' Поэтому стрипим suffix /filters/... — поиск
    становится по всему городу. У нас есть координаты в снапшоте, и UI
    может фильтровать по расстоянию от ТРЦ Академический."""
    if '/filters/' in url:
        url = url.split('/filters/')[0]
    return url.rstrip('/')


def extract_street(address: str | None) -> str:
    """'улица Вильгельма де Геннина, 33' → 'улица Вильгельма де Геннина'.
    Берём всё до первой запятой — этого достаточно для группировки в UI."""
    if not address:
        return ''
    m = re.match(r'^([^,]+)', address)
    return m.group(1).strip() if m else ''


def setup_logging(run_id: int | None = None) -> Path:
    log_file = LOG_DIR / f'{datetime.now():%Y-%m-%d_%H-%M}.log'
    fmt = '%(asctime)s [%(levelname)s] %(message)s'
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8'),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    return log_file


# ── Запуск parser-2gis ────────────────────────────────────────────────────
def find_parser_binary() -> list[str] | None:
    """Возвращает команду-запускалку parser-2gis. Пакет регистрирует
    console_script `parser-2gis = parser_2gis:main`, поэтому есть три пути:
      1. shutil.which('parser-2gis') — обычный случай.
      2. ${python_dir}/Scripts/parser-2gis(.exe) рядом с интерпретатором.
      3. inline-вызов через -c — если ни первый, ни второй не нашлись."""
    found = shutil.which('parser-2gis')
    if found:
        return [found]

    # Windows: парсер часто лежит в Scripts/, но не всегда в PATH.
    py_dir = Path(sys.executable).parent
    for name in ('parser-2gis.exe', 'parser-2gis.cmd', 'parser-2gis'):
        cand = py_dir / 'Scripts' / name
        if cand.exists():
            return [str(cand)]
        cand2 = py_dir / name
        if cand2.exists():
            return [str(cand2)]

    # Последний шанс: -c "from parser_2gis import main; main()"
    try:
        r = subprocess.run(
            [sys.executable, '-c', 'import parser_2gis'],
            capture_output=True, timeout=10,
        )
        if r.returncode == 0:
            return [sys.executable, '-c', 'from parser_2gis import main; main()']
    except Exception:
        pass
    return None


def scrape_url(parser_cmd: list[str], url: str, raw_dump: Path | None = None,
               timeout: int = 1800, max_records: int | None = None) -> list[dict]:
    """Дёргает parser-2gis на одиночный URL поиска и возвращает список карточек.

    CLI parser-2gis принимает URL'ы прямо как аргументы (`-i URL1 URL2 ...`),
    выходной формат `-f json` пишет массив объектов CatalogItem (см.
    parser_2gis.writer.models.catalog_item.CatalogItem) — это сырая структура
    2GIS Catalog API.
    """
    out_path = Path(tempfile.mkstemp(suffix='.json', prefix='2gis_out_')[1])

    try:
        cmd = [
            *parser_cmd,
            '-i', url,
            '-o', str(out_path),
            '-f', 'json',
            # ВАЖНО: headless НЕ работает с 2GIS Web — у безголового Chrome
            # viewport нулевого размера, и 2GIS API отвечает 'Bound is
            # incorrect'. Поэтому окно открываем настоящее, развёрнутое.
            # Для запуска под Windows Task Scheduler это всё равно работает,
            # просто во время прогона на экране будет окно браузера.
            '--chrome.headless', 'no',
            '--chrome.start-maximized', 'yes',
            '--chrome.disable-images', 'yes',
            '--chrome.silent-browser', 'yes',
            '--parser.delay_between_clicks', '300',
            '--parser.skip-404-response', 'yes',
        ]
        if max_records is not None and max_records > 0:
            cmd += ['--parser.max-records', str(max_records)]
        res = subprocess.run(cmd, timeout=timeout, capture_output=True, text=True,
                             encoding='utf-8', errors='replace')

        # Сохраняем сырой выхлоп — пригождается, когда возвращает пустой
        # массив без явной ошибки. Без этого выяснить, что произошло, нельзя.
        if raw_dump:
            log_pair = raw_dump.with_suffix('.parser.log')
            log_pair.write_text(
                f'returncode: {res.returncode}\n\n'
                f'=== STDOUT ===\n{res.stdout or ""}\n\n'
                f'=== STDERR ===\n{res.stderr or ""}\n',
                encoding='utf-8',
            )

        if res.returncode != 0:
            logging.error('parser-2gis returncode=%d', res.returncode)
            if res.stdout: logging.error('stdout: %s', res.stdout[-1500:])
            if res.stderr: logging.error('stderr: %s', res.stderr[-1500:])
            return []

        # parser-2gis по умолчанию пишет с BOM (encoding=utf-8-sig).
        try:
            data = json.loads(out_path.read_text(encoding='utf-8-sig'))
        except Exception as e:
            logging.error('Не удалось прочитать JSON: %s', e)
            if res.stdout: logging.info('parser-2gis stdout: %s', res.stdout[-1000:])
            return []

        if not data:
            # Пустой массив — нужно понять, почему. Проблема может быть в
            # URL (404), в headless-режиме (страница не загрузилась), или
            # в антибот-защите 2GIS. Логируем выхлоп парсера, чтобы было
            # за что зацепиться.
            tail = (res.stdout or '').strip().splitlines()[-15:]
            if tail:
                logging.warning('parser-2gis вернул 0 записей. Последние строки:')
                for line in tail:
                    logging.warning('  %s', line)

        if not isinstance(data, list):
            return []

        if raw_dump:
            raw_dump.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding='utf-8',
            )
        return data
    finally:
        try: out_path.unlink()
        except Exception: pass


# ── Маппинг карточки 2GIS → поля БД ───────────────────────────────────────
# JSON parser-2gis возвращает массив объектов CatalogItem 2GIS Catalog API.
# Реальная схема (см. vendor-parser-2gis/parser_2gis/writer/models/):
#   id              — '141265769336625_f91d...' (firm_id до '_')
#   name            — отображаемое имя
#   address_name    — 'Димитрова проспект, 7' (одна строка)
#   address_comment — 'офис 413' (этаж/блок)
#   point           — {lat, lon}
#   reviews         — {general_rating, general_review_count, ...}
#   contact_groups  — [{contacts: [{type, value, url}]}]
#                     type ∈ phone | website | email | telegram | vkontakte ...
#   schedule        — {Mon: {working_hours: [{from, to}]}, ..., is_24x7}
#   rubrics         — [{name, ...}]
#   type            — 'branch' | 'org' | ...
DAY_RU = {'Mon': 'Пн', 'Tue': 'Вт', 'Wed': 'Ср', 'Thu': 'Чт',
          'Fri': 'Пт', 'Sat': 'Сб', 'Sun': 'Вс'}


def _schedule_to_str(sched: dict | None) -> str | None:
    """Преобразует расписание из JSON в человекочитаемую строку
    'Пн: 10:00-21:00; Вт: 10:00-21:00; ...'. Этот же формат лежит в Excel-импорте,
    чтобы UI отображал одинаково для обоих источников."""
    if not isinstance(sched, dict):
        return None
    if sched.get('is_24x7'):
        return 'Круглосуточно'
    parts = []
    for day, ru in DAY_RU.items():
        d = sched.get(day)
        if not isinstance(d, dict):
            continue
        slots = d.get('working_hours') or []
        if not slots:
            continue
        slot_strs = [f"{s.get('from', '')}-{s.get('to', '')}" for s in slots if isinstance(s, dict)]
        parts.append(f"{ru}: {', '.join(slot_strs)}")
    return '; '.join(parts) if parts else None


def _contacts(card: dict, kind: str) -> list[str]:
    """Достаёт все contacts с заданным type из contact_groups.
    `value` — техническое значение (телефон в международном формате, URL и т.д.)."""
    out: list[str] = []
    for grp in card.get('contact_groups') or []:
        if not isinstance(grp, dict):
            continue
        for c in grp.get('contacts') or []:
            if isinstance(c, dict) and c.get('type') == kind:
                v = c.get('value') or c.get('url') or c.get('text')
                if v:
                    out.append(str(v).strip())
    return out


def _safe_float(v) -> float | None:
    if isinstance(v, (int, float)):
        return float(v) if (v == v) else None  # отсекаем NaN
    if isinstance(v, str):
        try: return float(v.replace(',', '.'))
        except ValueError: return None
    return None


def _safe_int(v) -> int | None:
    if isinstance(v, bool):  # bool — подкласс int, защищаемся
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v == v:
        return int(v)
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def card_to_metrics(card: dict) -> dict:
    """Достаёт стабильный набор полей из CatalogItem JSON. Возвращаемые
    значения уже подходят для записи в ext_orgs / ext_snapshots."""
    name = (card.get('name') or '').strip()
    address = (card.get('address_name') or '').strip()
    addr_comment = (card.get('address_comment') or '').strip()

    point = card.get('point') if isinstance(card.get('point'), dict) else {}
    lat = _safe_float(point.get('lat'))
    lng = _safe_float(point.get('lon'))

    reviews = card.get('reviews') if isinstance(card.get('reviews'), dict) else {}
    rating = _safe_float(reviews.get('general_rating'))
    reviews_count = _safe_int(reviews.get('general_review_count'))

    phones    = _contacts(card, 'phone')
    websites  = _contacts(card, 'website')
    emails    = _contacts(card, 'email')
    telegrams = _contacts(card, 'telegram')
    vks       = _contacts(card, 'vkontakte')

    hours = _schedule_to_str(card.get('schedule'))

    # Идентификатор филиала в 2GIS — берём всё до первого '_'.
    raw_id = str(card.get('id') or '')
    firm_id = raw_id.split('_')[0] if raw_id else ''
    gis_url = f'https://2gis.ru/firm/{firm_id}' if firm_id else None

    rubrics = []
    for r in card.get('rubrics') or []:
        if isinstance(r, dict) and r.get('name'):
            rubrics.append(str(r['name']))

    return {
        'name': name,
        'address': address,
        'address_comment': addr_comment or None,
        'rating': rating,
        'reviews': reviews_count,
        'phones': phones,
        'website': websites[0] if websites else None,
        'websites_all': websites,
        'emails': emails,
        'telegrams': telegrams,
        'vk': vks,
        'hours': hours,
        'latitude': lat,
        'longitude': lng,
        'gis_id': firm_id or None,
        'gis_url': gis_url,
        'rubrics': rubrics,
        'type': card.get('type'),
    }


# ── Работа с БД ───────────────────────────────────────────────────────────
def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f'БД не найдена: {path}')
    conn = sqlite3.connect(path, isolation_level=None)  # autocommit-режим
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA foreign_keys = ON')
    conn.row_factory = sqlite3.Row
    return conn


def get_categories(conn, limit: int | None = None,
                   only_id: int | None = None) -> list[sqlite3.Row]:
    sql = 'SELECT id, name, search_url FROM ext_categories WHERE active = 1'
    args: list = []
    if only_id is not None:
        sql += ' AND id = ?'
        args.append(only_id)
    sql += ' ORDER BY id'
    if limit:
        sql += f' LIMIT {int(limit)}'
    return list(conn.execute(sql, args).fetchall())


def upsert_org(conn, run_iso: str, category_id: int, category_name: str,
               metrics: dict) -> int | None:
    """ext_orgs дедуплицируется по (категория|название|адрес). Если карточка уже
    видели — обновляем last_seen_at и базовые поля, но id сохраняем. Это даёт:
      • первую дату появления (first_seen_at)
      • дату последнего наблюдения (last_seen_at)
      • стабильный id для истории снапшотов.
    """
    name = metrics['name']
    address = metrics['address']
    if not name:
        return None

    key = dedupe_key(category_name, name, address)
    street = extract_street(address)

    row = conn.execute('SELECT id FROM ext_orgs WHERE dedupe_key = ?', (key,)).fetchone()
    if row:
        org_id = row['id']
        conn.execute(
            'UPDATE ext_orgs SET name = ?, address = ?, street = ?, last_seen_at = ? WHERE id = ?',
            (name, address, street, run_iso, org_id),
        )
    else:
        cur = conn.execute(
            'INSERT INTO ext_orgs '
            '(dedupe_key, category_id, name, address, street, is_duplicate, first_seen_at, last_seen_at) '
            'VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
            (key, category_id, name, address, street, run_iso, run_iso),
        )
        org_id = cur.lastrowid
    return org_id


def insert_snapshot(conn, run_id: int, org_id: int, metrics: dict) -> None:
    """Пишет снапшот. raw_json — компактная сводка по обогащённым полям
    (email, telegram, vk, рубрики, 2gis_url), а не вся катушка CatalogItem.
    Если нужен полный исходник — используйте --keep-raw, он сохранит JSON
    каждой категории в parser/logs/raw_*.json."""
    extra = {
        'address_comment': metrics.get('address_comment'),
        'gis_id':   metrics.get('gis_id'),
        'gis_url':  metrics.get('gis_url'),
        'rubrics':  metrics.get('rubrics') or None,
        'emails':   metrics.get('emails') or None,
        'telegram': metrics.get('telegrams') or None,
        'vk':       metrics.get('vk') or None,
        'websites_all': metrics.get('websites_all') or None,
        'type':     metrics.get('type'),
    }
    extra = {k: v for k, v in extra.items() if v}

    conn.execute(
        'INSERT INTO ext_snapshots '
        '(run_id, org_id, rating, reviews_count, phones, website, hours, longitude, latitude, raw_json) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (run_id, org_id,
         metrics['rating'], metrics['reviews'],
         json.dumps(metrics['phones'], ensure_ascii=False) if metrics['phones'] else None,
         metrics['website'], metrics['hours'],
         metrics['longitude'], metrics['latitude'],
         json.dumps(extra, ensure_ascii=False) if extra else None),
    )


def begin_run(conn) -> int:
    cur = conn.execute(
        'INSERT INTO ext_runs (started_at, status, source, categories_total, categories_done) '
        "VALUES (?, 'running', 'parser-2gis', 0, 0)",
        (now_iso(),),
    )
    return cur.lastrowid


def finalize_run(conn, run_id: int, status: str,
                 total_orgs: int, error_msg: str | None = None) -> None:
    conn.execute(
        'UPDATE ext_runs SET status = ?, finished_at = ?, total_orgs = ?, error_msg = ? '
        'WHERE id = ?',
        (status, now_iso(), total_orgs, error_msg, run_id),
    )


# ── main ──────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description='2GIS scraper for dashboard.db')
    ap.add_argument('--limit', type=int, help='Только первые N категорий (для теста)')
    ap.add_argument('--category', type=int, help='Прогнать только одну категорию по id')
    ap.add_argument('--delay', type=int, default=30,
                    help='Пауза между категориями в секундах (default: 30)')
    ap.add_argument('--keep-raw', action='store_true',
                    help='Сохранять JSON-выгрузку каждой категории в logs/raw_*.json')
    ap.add_argument('--max-records', type=int, default=None,
                    help='Лимит записей с одной категории (для теста). По умолчанию — без лимита.')
    args = ap.parse_args()

    setup_logging()
    logging.info('Старт парсера. БД: %s', DB_PATH)

    parser_cmd = find_parser_binary()
    if not parser_cmd:
        logging.error('parser-2gis не установлен. Запустите: pip install parser-2gis')
        return 2
    logging.info('parser-2gis: %s', ' '.join(parser_cmd))

    conn = open_db(DB_PATH)
    run_id = begin_run(conn)
    logging.info('Создан прогон ext_runs.id=%d', run_id)

    total_orgs = 0
    error_msg: str | None = None
    try:
        cats = get_categories(conn, args.limit, args.category)
        logging.info('Категорий к обходу: %d', len(cats))
        conn.execute('UPDATE ext_runs SET categories_total = ? WHERE id = ?',
                     (len(cats), run_id))

        for i, cat in enumerate(cats, 1):
            cat_id, cat_name, url = cat['id'], cat['name'], cat['search_url']
            logging.info('[%d/%d] %s (id=%d)', i, len(cats), cat_name, cat_id)

            raw_dump = (LOG_DIR / f'raw_{run_id}_{cat_id}.json') if args.keep_raw else None

            try:
                cards = scrape_url(parser_cmd, normalize_search_url(url), raw_dump=raw_dump,
                                   max_records=args.max_records)
                logging.info('  карточек получено: %d', len(cards))

                run_iso = now_iso()
                for card in cards:
                    metrics = card_to_metrics(card)
                    if not metrics['name']:
                        continue
                    org_id = upsert_org(conn, run_iso, cat_id, cat_name, metrics)
                    if org_id:
                        insert_snapshot(conn, run_id, org_id, metrics)
                        total_orgs += 1
            except Exception as e:
                logging.exception('  ошибка в категории «%s»: %s', cat_name, e)

            conn.execute('UPDATE ext_runs SET categories_done = ? WHERE id = ?',
                         (i, run_id))

            if i < len(cats) and args.delay > 0:
                time.sleep(args.delay)

        finalize_run(conn, run_id, 'ok', total_orgs)
        logging.info('Готово. Всего снапшотов: %d', total_orgs)
        return 0
    except Exception as e:
        logging.exception('Фатальная ошибка прогона')
        error_msg = str(e)
        finalize_run(conn, run_id, 'error', total_orgs, error_msg)
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())
