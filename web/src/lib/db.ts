/**
 * SQLite access via Node 22.5+ built-in `node:sqlite`.
 * Shared DB: C:\Users\Князева\Desktop\TRC_tools\dashboard.db
 * (already populated by the legacy Flask app — we extend it with richer tables).
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), '..', 'dashboard.db');

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(SCHEMA);
  return _db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rent_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at   TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  month_num     INTEGER NOT NULL,
  row_num       INTEGER,
  floor         TEXT,
  room          TEXT,
  legal         TEXT,
  trade         TEXT,
  status        TEXT,
  area          REAL,
  rate          REAL,
  plan_vat      REAL,
  plan_oplat    REAL,
  fact_vat      REAL,
  fact_oplat    REAL
);
CREATE INDEX IF NOT EXISTS idx_rent_daily_date ON rent_daily(snapshot_date, month_num);
CREATE INDEX IF NOT EXISTS idx_rent_daily_room ON rent_daily(snapshot_date, month_num, room);
CREATE INDEX IF NOT EXISTS idx_rent_daily_legal ON rent_daily(snapshot_date, legal);

CREATE TABLE IF NOT EXISTS rent_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at   TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  month_num     INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  floor         TEXT,
  room          TEXT,
  prev_legal    TEXT,
  next_legal    TEXT,
  prev_rate     REAL,
  next_rate     REAL,
  prev_status   TEXT,
  next_status   TEXT
);
CREATE INDEX IF NOT EXISTS idx_rent_changes_date ON rent_changes(snapshot_date);

CREATE TABLE IF NOT EXISTS dec_reference (
  room     TEXT PRIMARY KEY,
  legal    TEXT,
  trade    TEXT,
  status   TEXT,
  area     REAL,
  rate     REAL,
  plan_vat REAL
);

CREATE TABLE IF NOT EXISTS monthly_totals_ext (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at   TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  month_num     INTEGER NOT NULL,
  plan_s_to     REAL,
  plan_bez_to   REAL,
  fact_s_to     REAL,
  fact_bez_to   REAL
);
CREATE INDEX IF NOT EXISTS idx_mt_ext_date ON monthly_totals_ext(snapshot_date, month_num);

CREATE TABLE IF NOT EXISTS tenant_comments (
  trade      TEXT PRIMARY KEY,        -- бренд (соответствует rent_daily.trade)
  comment    TEXT,
  updated_at TEXT NOT NULL
);

-- Legacy tables originally owned by app.py:init_db. Mirrored here so a
-- fresh install where poll.py hasn't run yet still works — the manual
-- "Обновить" button writes to these alongside the extended tables.
-- Columns MUST stay identical to app.py's CREATE TABLE.
CREATE TABLE IF NOT EXISTS monthly_totals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at  TEXT NOT NULL,
  month_num    INTEGER NOT NULL,
  plan_s_to    REAL,
  plan_bez_to  REAL,
  fact_s_to    REAL,
  fact_bez_to  REAL
);
CREATE TABLE IF NOT EXISTS tenant_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at  TEXT NOT NULL,
  month_num    INTEGER NOT NULL,
  row_num      INTEGER NOT NULL,
  tenant_name  TEXT,
  oplaceno_ap  REAL
);
CREATE TABLE IF NOT EXISTS payment_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at  TEXT NOT NULL,
  month_num    INTEGER NOT NULL,
  month_name   TEXT NOT NULL,
  tenant_name  TEXT NOT NULL,
  old_value    REAL,
  new_value    REAL,
  delta        REAL NOT NULL
);

-- ── Съезды и заезды арендаторов ───────────────────────────────────────
-- Историческая таблица движений арендаторов: расторжения договоров (съезды)
-- и новые договоры (заезды). Источник — годовые Excel-файлы план-факт со
-- шары Acad-server (папка 01_Бюджет, разбита по годам), лист «4 съезд-заезд»
-- (в более старых годах формат другой — парсер ищет маркеры в любых листах).
-- Импорт идемпотентен: UNIQUE по (year, kind, seq_no, room) ловит повторы.
CREATE TABLE IF NOT EXISTS tenant_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  year            INTEGER NOT NULL,
  kind            TEXT NOT NULL,            -- 'departure' (съезд) | 'arrival' (заезд)
  seq_no          INTEGER,                  -- № строки в исходном реестре
  floor           TEXT,                     -- '1' / '2' / 'УЛ' / ...
  room            TEXT,                     -- код помещения 'R1-6', 'К2-3', ...
  area_m2         REAL,
  rate_per_m2     REAL,
  legal_name      TEXT,                     -- 'ИП Иванов', 'ООО Ромашка'
  trade_name      TEXT,                     -- торговое наименование
  charges_no_vat  REAL,
  charges_with_vat REAL,
  event_date      TEXT,                     -- 'YYYY-MM-DD' если распарсилось
  date_raw        TEXT,                     -- если в Excel пришла строка
  source_file     TEXT NOT NULL,            -- абсолютный путь к xlsx
  source_sheet    TEXT NOT NULL,            -- имя листа в xlsx
  source_row      INTEGER,                  -- номер строки в листе
  imported_at     TEXT NOT NULL,
  UNIQUE(year, kind, seq_no, room, source_file)
);
CREATE INDEX IF NOT EXISTS idx_tm_year_kind ON tenant_movements(year, kind);
CREATE INDEX IF NOT EXISTS idx_tm_room      ON tenant_movements(room);
CREATE INDEX IF NOT EXISTS idx_tm_date      ON tenant_movements(event_date);

-- ── История статуса помещений (Сдан/Не сдан) ──────────────────────────
-- Помесячный снапшот каждого помещения за все годы. Извлекается Python-
-- парсером import_status_history.py из помесячных листов годовых файлов
-- план-факт. Главный кейс: построить timeline занятости по комнатам и
-- общую динамику свободных площадей по ТРЦ.
CREATE TABLE IF NOT EXISTS rent_status_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  year          INTEGER NOT NULL,           -- календарный год периода
  month         INTEGER NOT NULL,           -- 1..12
  floor         TEXT,
  room          TEXT,
  area_m2       REAL,
  status        TEXT NOT NULL,              -- 'rented' | 'not_rented' | 'other'
  status_raw    TEXT,                       -- сырой текст из ячейки
  legal_name    TEXT,
  trade_name    TEXT,
  rate_per_m2   REAL,
  source_file   TEXT NOT NULL,
  source_sheet  TEXT NOT NULL,
  imported_at   TEXT NOT NULL,
  UNIQUE(year, month, room, source_file)
);
CREATE INDEX IF NOT EXISTS idx_rsh_year_month ON rent_status_history(year, month);
CREATE INDEX IF NOT EXISTS idx_rsh_room       ON rent_status_history(room);
CREATE INDEX IF NOT EXISTS idx_rsh_status     ON rent_status_history(status);

-- ── Товарооборот арендаторов (годовой) ────────────────────────────────
-- Снапшоты годовых показателей по каждому арендатору из листа «НОВАЯ»
-- файла 02_ТО АП.xlsx. Источник — Python-парсер import_turnover.py.
-- UNIQUE по (year, store_name) обеспечивает идемпотентность импорта.
CREATE TABLE IF NOT EXISTS turnover_yearly (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  year               INTEGER NOT NULL,
  arendator          TEXT,                  -- юр. лицо
  store_name         TEXT NOT NULL,         -- название магазина
  category           TEXT,
  area_m2            REAL,
  rate_fixed         REAL,                  -- ставка фикс
  rate_fixed_to      REAL,                  -- ставка фикс + ТО
  ap_fixed           REAL,                  -- АП фикс
  ap_fixed_indexed   REAL,                  -- АП фикс после индексации
  ap_extra           REAL,                  -- Доп. АП
  to_percent         REAL,                  -- % с ТО
  ap_with_to         REAL,                  -- АП с учётом ТО
  ap_share_in_to     REAL,                  -- Доля АП в ТО
  to_sum_year        REAL,                  -- ТО сумма за год
  to_sum_period      REAL,                  -- ТО сумма за период (янв-ноя)
  to_avg_monthly     REAL,                  -- ТО средний (месячный)
  to_per_m2          REAL,                  -- ТО с м² (ключевой показатель)
  avg_traffic        REAL,
  avg_purchases      REAL,
  avg_check          REAL,
  ap_change_note     TEXT,                  -- Изменение условий АП
  to_yoy_pct         REAL,                  -- Сравнение ср. ТО vs пред. год
  source_file        TEXT NOT NULL,
  imported_at        TEXT NOT NULL,
  UNIQUE(year, store_name)
);
CREATE INDEX IF NOT EXISTS idx_turnover_year     ON turnover_yearly(year);
CREATE INDEX IF NOT EXISTS idx_turnover_category ON turnover_yearly(category);
CREATE INDEX IF NOT EXISTS idx_turnover_store    ON turnover_yearly(store_name);

-- ── Помесячный товарооборот ────────────────────────────────────────────
-- 12 месяцев × N арендаторов на каждый год. Заполняется из колонок
-- 23..94 листа «НОВАЯ» (6 показателей на месяц: to_sum, to_per_m2,
-- yoy_pct, mom_pct, purchases, ap).
-- UNIQUE по (year, month, store_name) обеспечивает идемпотентность.
CREATE TABLE IF NOT EXISTS turnover_monthly (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,                  -- 1..12
  store_name      TEXT NOT NULL,
  category        TEXT,
  area_m2         REAL,
  to_sum          REAL,                              -- ТО за месяц
  to_per_m2       REAL,                              -- ТО с м² за месяц
  yoy_pct         REAL,                              -- % к этому месяцу пред. года
  mom_pct         REAL,                              -- % к прошлому месяцу
  purchases       REAL,                              -- кол-во покупок
  ap_for_month    REAL,                              -- АП за месяц
  source_file     TEXT NOT NULL,
  imported_at     TEXT NOT NULL,
  UNIQUE(year, month, store_name)
);
CREATE INDEX IF NOT EXISTS idx_turnover_monthly_year_month ON turnover_monthly(year, month);
CREATE INDEX IF NOT EXISTS idx_turnover_monthly_store      ON turnover_monthly(store_name);

-- ── Focus: поведенческие метрики из кассовой выгрузки ─────────────────
-- Заполняется parser/import_focus.py. Товарооборот/продажи Focus НЕ берём
-- (у нас свой ТО), только средний чек, число чеков, продажи/м², возвраты.
-- store_name сматчен к turnover_monthly (NULL если магазин не привязан).
CREATE TABLE IF NOT EXISTS focus_monthly (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store_name    TEXT,
  focus_name    TEXT NOT NULL,
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

-- ── Карта метрик по этажам ────────────────────────────────────────────
-- Зоны арендаторов на планах этажей (подложка — SVG из CorelDRAW). Геометрия
-- размечается один раз в редакторе /map: points — список вершин полигона в
-- координатах плана (viewBox 0 0 29700 21000). store_name связывает зону с
-- товарооборотом/Focus. Дальше зоны красятся любой метрикой.
CREATE TABLE IF NOT EXISTS map_zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  floor       INTEGER NOT NULL,
  store_name  TEXT NOT NULL,
  points      TEXT NOT NULL,           -- JSON: [[x,y],...] в координатах плана
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_zones_floor ON map_zones(floor);

-- ── Application settings (key-value) ──────────────────────────────────
-- Динамические настройки приложения, которые пользователь может менять
-- из UI без правки .env и без перезапуска. Например: путь к Excel-файлу
-- 2GIS, расписание парсера, токены интеграций и т.д.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TEXT NOT NULL
);

-- ── External 2GIS context ─────────────────────────────────────────────
-- Снапшоты внешнего окружения: справочник категорий, прогоны парсера,
-- организации (дедуплицированные) и метрики на момент каждого прогона.
-- Парсер пишет сюда раз в неделю — UI читает.
CREATE TABLE IF NOT EXISTS ext_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  search_url  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  added_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ext_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL DEFAULT 'running',  -- running | ok | error
  error_msg         TEXT,
  total_orgs        INTEGER,
  categories_done   INTEGER DEFAULT 0,
  categories_total  INTEGER DEFAULT 0,
  source            TEXT                              -- 'excel-import' | 'parser-2gis' | 'manual'
);

CREATE TABLE IF NOT EXISTS ext_orgs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key      TEXT NOT NULL UNIQUE,    -- 'Категория|Название|Адрес' (нижний регистр)
  category_id     INTEGER NOT NULL,
  name            TEXT NOT NULL,
  address         TEXT,
  street          TEXT,
  is_duplicate    INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES ext_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_ext_orgs_category ON ext_orgs(category_id);

CREATE TABLE IF NOT EXISTS ext_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL,
  org_id         INTEGER NOT NULL,
  rating         REAL,
  reviews_count  INTEGER,
  phones         TEXT,           -- JSON array
  website        TEXT,
  hours          TEXT,           -- JSON
  longitude      REAL,
  latitude       REAL,
  raw_json       TEXT,           -- сырой ответ парсера для будущих фич
  FOREIGN KEY (run_id) REFERENCES ext_runs(id),
  FOREIGN KEY (org_id) REFERENCES ext_orgs(id)
);
CREATE INDEX IF NOT EXISTS idx_ext_snapshots_run ON ext_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_ext_snapshots_org ON ext_snapshots(org_id);
`;

export function localDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function localIsoDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function prevDate(date: string): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function latestSnapshotDate(): string | null {
  const row = db().prepare('SELECT MAX(snapshot_date) AS d FROM rent_daily').get() as { d?: string };
  return row?.d ?? null;
}

// ── App settings: key-value ────────────────────────────────────────────
// Хранит динамические параметры (пути к файлам, расписания, токены).
// UI правит их через POST /api/settings, без перезапуска и без .env.

export function getSetting(key: string): string | null {
  const row = db()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value?: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null, description?: string): void {
  db()
    .prepare(`
      INSERT INTO app_settings (key, value, description, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value       = excluded.value,
        description = COALESCE(excluded.description, app_settings.description),
        updated_at  = excluded.updated_at
    `)
    .run(key, value, description ?? null, localIsoDateTime());
}

export function listSettings(): { key: string; value: string | null; description: string | null; updatedAt: string }[] {
  return db()
    .prepare('SELECT key, value, description, updated_at AS updatedAt FROM app_settings ORDER BY key')
    .all() as { key: string; value: string | null; description: string | null; updatedAt: string }[];
}
