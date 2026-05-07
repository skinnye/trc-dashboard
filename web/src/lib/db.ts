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
