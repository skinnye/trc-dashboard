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
