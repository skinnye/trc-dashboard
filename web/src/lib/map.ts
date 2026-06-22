/**
 * Карта метрик по этажам: зоны арендаторов (map_zones) + значения метрик
 * по магазинам для раскраски. Геометрия размечается в редакторе /map,
 * метрики берутся из turnover_monthly / focus_monthly по store_name.
 */
import { db, localIsoDateTime } from './db';

export interface MapZone {
  id: number;
  floor: number;
  storeName: string;
  points: [number, number][];
}

export function getZones(floor: number): MapZone[] {
  const rows = db()
    .prepare('SELECT id, floor, store_name AS storeName, points FROM map_zones WHERE floor = ? ORDER BY id')
    .all(floor) as { id: number; floor: number; storeName: string; points: string }[];
  return rows.map(r => ({ ...r, points: safeParse(r.points) }));
}

function safeParse(s: string): [number, number][] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveZone(floor: number, storeName: string, points: [number, number][], id?: number): number {
  const now = localIsoDateTime();
  const conn = db();
  if (id) {
    conn.prepare('UPDATE map_zones SET floor = ?, store_name = ?, points = ?, updated_at = ? WHERE id = ?')
      .run(floor, storeName, JSON.stringify(points), now, id);
    return id;
  }
  const r = conn.prepare(
    'INSERT INTO map_zones (floor, store_name, points, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(floor, storeName, JSON.stringify(points), now, now);
  return Number(r.lastInsertRowid);
}

export function deleteZone(id: number): void {
  db().prepare('DELETE FROM map_zones WHERE id = ?').run(id);
}

// Магазины для выпадающего списка в редакторе — из последнего года ТО.
export function getStoreList(): { storeName: string; category: string | null }[] {
  const y = latestTurnoverYear();
  if (!y) return [];
  return db()
    .prepare(`SELECT DISTINCT store_name AS storeName, MAX(category) AS category
              FROM turnover_monthly WHERE year = ? GROUP BY store_name ORDER BY store_name`)
    .all(y) as { storeName: string; category: string | null }[];
}

function latestTurnoverYear(): number | null {
  const r = db().prepare('SELECT MAX(year) AS y FROM turnover_monthly').get() as { y: number | null };
  return r?.y ?? null;
}

export type MapMetric = 'to' | 'to_per_m2' | 'receipts' | 'avg_check';

export const METRIC_LABELS: Record<MapMetric, { label: string; unit: string }> = {
  to:         { label: 'Товарооборот', unit: '₽' },
  to_per_m2:  { label: 'ТО на м²',     unit: '₽/м²' },
  receipts:   { label: 'Число чеков',  unit: 'шт' },
  avg_check:  { label: 'Средний чек',  unit: '₽' },
};

// Доступный период данных как 'YYYY-MM' (для пикеров дат).
export function getPeriodBounds(): { min: string; max: string } | null {
  const r = db().prepare(`SELECT MIN(year*100+month) AS lo, MAX(year*100+month) AS hi
                          FROM turnover_monthly WHERE to_sum IS NOT NULL`).get() as { lo: number; hi: number };
  if (!r?.lo) return null;
  const fmt = (n: number) => `${Math.floor(n / 100)}-${String(n % 100).padStart(2, '0')}`;
  return { min: fmt(r.lo), max: fmt(r.hi) };
}

// Значение метрики по магазину за период [fromYM..toYM], где YM = year*100+month.
export function getMetricByStore(metric: MapMetric, fromYM: number, toYM: number): Record<string, number> {
  const rng = '(year*100+month) BETWEEN ? AND ?';
  let rows: { store: string; v: number }[] = [];
  if (metric === 'to') {
    rows = db().prepare(`SELECT store_name AS store, COALESCE(SUM(to_sum),0) AS v
                         FROM turnover_monthly WHERE ${rng} AND to_sum IS NOT NULL GROUP BY store_name`)
      .all(fromYM, toYM) as { store: string; v: number }[];
  } else if (metric === 'to_per_m2') {
    rows = db().prepare(`SELECT store_name AS store, AVG(to_per_m2) AS v
                         FROM turnover_monthly WHERE ${rng} AND to_per_m2 IS NOT NULL GROUP BY store_name`)
      .all(fromYM, toYM) as { store: string; v: number }[];
  } else if (metric === 'receipts') {
    rows = db().prepare(`SELECT store_name AS store, COALESCE(SUM(receipts),0) AS v
                         FROM focus_monthly WHERE ${rng} AND store_name IS NOT NULL AND receipts IS NOT NULL GROUP BY store_name`)
      .all(fromYM, toYM) as { store: string; v: number }[];
  } else { // avg_check — взвешенный по числу чеков
    rows = db().prepare(`SELECT store_name AS store,
                           CASE WHEN SUM(receipts) > 0 THEN SUM(avg_check*receipts)/SUM(receipts) ELSE NULL END AS v
                         FROM focus_monthly WHERE ${rng} AND store_name IS NOT NULL GROUP BY store_name`)
      .all(fromYM, toYM) as { store: string; v: number }[];
  }
  const out: Record<string, number> = {};
  for (const r of rows) if (r.v != null) out[r.store] = r.v;
  return out;
}

export function latestYear(): number | null { return latestTurnoverYear(); }
