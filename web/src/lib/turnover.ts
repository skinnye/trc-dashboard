/**
 * Чтение годовой статистики товарооборота арендаторов из turnover_yearly.
 * Источник — Python-парсер import_turnover.py.
 */
import { db } from './db';

export interface YearStat {
  year: number;
  count: number;
  toTotal: number;       // суммарный ТО за год, ₽
  toAvgPerM2: number;    // средний ТО с м² по арендаторам, ₽
  apTotal: number;       // суммарная АП за год
  apShareInTo: number;   // средняя доля АП в ТО
}

export function getYearlyTotals(): YearStat[] {
  return db()
    .prepare(`
      SELECT year,
             COUNT(*) AS count,
             COALESCE(SUM(to_sum_year), 0)    AS toTotal,
             COALESCE(AVG(to_per_m2), 0)      AS toAvgPerM2,
             COALESCE(SUM(ap_with_to), 0)     AS apTotal,
             COALESCE(AVG(ap_share_in_to), 0) AS apShareInTo
      FROM turnover_yearly
      GROUP BY year ORDER BY year
    `)
    .all() as unknown as YearStat[];
}

export interface TenantRow {
  id: number;
  year: number;
  arendator: string | null;
  storeName: string;
  category: string | null;
  areaM2: number | null;
  toSumYear: number | null;
  toAvgMonthly: number | null;
  toPerM2: number | null;
  apWithTo: number | null;
  apShareInTo: number | null;
  avgTraffic: number | null;
  avgPurchases: number | null;
  avgCheck: number | null;
  toYoyPct: number | null;
}

export function getTenantsForYear(year: number): TenantRow[] {
  return db()
    .prepare(`
      SELECT id, year, arendator,
             store_name      AS storeName,
             category, area_m2 AS areaM2,
             to_sum_year     AS toSumYear,
             to_avg_monthly  AS toAvgMonthly,
             to_per_m2       AS toPerM2,
             ap_with_to      AS apWithTo,
             ap_share_in_to  AS apShareInTo,
             avg_traffic     AS avgTraffic,
             avg_purchases   AS avgPurchases,
             avg_check       AS avgCheck,
             to_yoy_pct      AS toYoyPct
      FROM turnover_yearly
      WHERE year = ?
      ORDER BY to_sum_year DESC NULLS LAST
    `)
    .all(year) as unknown as TenantRow[];
}

// Сводка по категориям за конкретный год.
export interface CategoryStat {
  category: string;
  count: number;
  toTotal: number;
  toAvgPerM2: number;
  areaTotal: number;
}

export function getCategoryStats(year: number): CategoryStat[] {
  return db()
    .prepare(`
      SELECT COALESCE(category, '— без категории') AS category,
             COUNT(*) AS count,
             COALESCE(SUM(to_sum_year), 0) AS toTotal,
             COALESCE(AVG(to_per_m2), 0)   AS toAvgPerM2,
             COALESCE(SUM(area_m2), 0)     AS areaTotal
      FROM turnover_yearly
      WHERE year = ?
      GROUP BY category
      ORDER BY toTotal DESC
    `)
    .all(year) as unknown as CategoryStat[];
}

// Тайм-лайн одного магазина за все годы.
export interface StoreTimelinePoint {
  year: number;
  toSumYear: number | null;
  toPerM2: number | null;
  areaM2: number | null;
  category: string | null;
}

export function getStoreTimeline(storeName: string): StoreTimelinePoint[] {
  return db()
    .prepare(`
      SELECT year,
             to_sum_year AS toSumYear,
             to_per_m2   AS toPerM2,
             area_m2     AS areaM2,
             category
      FROM turnover_yearly
      WHERE store_name = ?
      ORDER BY year
    `)
    .all(storeName) as unknown as StoreTimelinePoint[];
}

// ── Помесячная аналитика ──────────────────────────────────────────────

// Сумма ТО по всему ТРЦ помесячно за год + YoY относительно того же
// месяца прошлого года. Один запрос с pivot — без N+1.
export interface MonthlyTotalsPoint {
  month: number;          // 1..12
  toTotal: number;        // суммарный ТО за месяц
  toPerM2Avg: number;     // средний ТО/м² по магазинам в этом месяце
  storesCount: number;    // сколько магазинов сдало данные за месяц
  toLastYear: number;     // ТО за этот же месяц предыдущего года
  yoyPct: number;         // (cur/prev - 1) * 100, или null если prev = 0
}

export function getYearMonthlyTotals(year: number): MonthlyTotalsPoint[] {
  return db()
    .prepare(`
      WITH cur AS (
        SELECT month,
               COALESCE(SUM(to_sum), 0)   AS toTotal,
               COALESCE(AVG(to_per_m2), 0) AS toPerM2Avg,
               COUNT(DISTINCT store_name) AS storesCount
        FROM turnover_monthly
        WHERE year = ?
        GROUP BY month
      ),
      prev AS (
        SELECT month, COALESCE(SUM(to_sum), 0) AS toTotal
        FROM turnover_monthly
        WHERE year = ? - 1
        GROUP BY month
      )
      SELECT cur.month                                  AS month,
             cur.toTotal                                AS toTotal,
             cur.toPerM2Avg                             AS toPerM2Avg,
             cur.storesCount                            AS storesCount,
             COALESCE(prev.toTotal, 0)                  AS toLastYear,
             CASE
               WHEN COALESCE(prev.toTotal, 0) = 0 THEN NULL
               ELSE (cur.toTotal / prev.toTotal - 1) * 100
             END                                        AS yoyPct
      FROM cur
      LEFT JOIN prev ON prev.month = cur.month
      ORDER BY cur.month
    `)
    .all(year, year) as unknown as MonthlyTotalsPoint[];
}

// Pivot-матрица store × month за год. Один запрос — без N+1 даже при
// 100+ магазинах на странице.
export interface StoreMonthlyRow {
  storeName: string;
  category: string | null;
  areaM2: number | null;
  toYearTotal: number;
  m: (number | null)[];   // 12 элементов, индекс 0 = январь
}

export function getYearStoreMonthlyMatrix(year: number, metric: 'to_sum' | 'to_per_m2' = 'to_sum'): StoreMonthlyRow[] {
  // Здесь приходится использовать конкатенацию имени столбца — это
  // безопасно, потому что значение приходит из enum в типе аргумента.
  const col = metric === 'to_per_m2' ? 'to_per_m2' : 'to_sum';
  const rows = db()
    .prepare(`
      SELECT store_name AS storeName,
             MAX(category) AS category,
             MAX(area_m2)  AS areaM2,
             COALESCE(SUM(to_sum), 0) AS toYearTotal,
             month, ${col} AS v
      FROM turnover_monthly
      WHERE year = ?
      GROUP BY store_name, month
      ORDER BY toYearTotal DESC, store_name
    `)
    .all(year) as unknown as {
      storeName: string; category: string | null; areaM2: number | null;
      toYearTotal: number; month: number; v: number | null;
    }[];

  const map = new Map<string, StoreMonthlyRow>();
  for (const r of rows) {
    let row = map.get(r.storeName);
    if (!row) {
      row = { storeName: r.storeName, category: r.category, areaM2: r.areaM2,
              toYearTotal: r.toYearTotal, m: Array(12).fill(null) };
      map.set(r.storeName, row);
    }
    if (r.month >= 1 && r.month <= 12) row.m[r.month - 1] = r.v;
  }
  return Array.from(map.values()).sort((a, b) => b.toYearTotal - a.toYearTotal);
}

// Timeline одного магазина по всем месяцам всех годов.
export interface StoreMonthlyTimelinePoint {
  year: number;
  month: number;
  toSum: number | null;
  toPerM2: number | null;
  yoyPct: number | null;
  momPct: number | null;
  purchases: number | null;
  ap: number | null;
}

export function getStoreMonthlyTimeline(storeName: string): StoreMonthlyTimelinePoint[] {
  return db()
    .prepare(`
      SELECT year, month,
             to_sum       AS toSum,
             to_per_m2    AS toPerM2,
             yoy_pct      AS yoyPct,
             mom_pct      AS momPct,
             purchases    AS purchases,
             ap_for_month AS ap
      FROM turnover_monthly
      WHERE store_name = ?
      ORDER BY year, month
    `)
    .all(storeName) as unknown as StoreMonthlyTimelinePoint[];
}
