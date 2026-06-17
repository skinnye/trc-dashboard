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

// ── Корректное сравнение: период-в-период YoY ─────────────────────────
// Готовый to_yoy_pct из Excel ненадёжен (для 2026 правдоподобны лишь 8 из
// 52 значений, разброс −98%..+1116%). Считаем сравнение сами:
//   • ТО за ДОСТУПНЫЙ период этого года (YTD) — сумма помесячных за месяцы,
//     где у магазина есть данные (у 2026 это обычно Янв–Май);
//   • YoY = сумма за СОВПАДАЮЩИЕ месяцы этого года ÷ те же месяцы прошлого
//     года − 1. Сопоставляем только месяцы, присутствующие в ОБОИХ годах,
//     чтобы сравнение было «как с как» (а не YTD vs полный год).
export interface TenantPeriodRow {
  storeName: string;
  arendator: string | null;
  category: string | null;
  areaM2: number | null;
  toPerM2: number | null;       // ТО/м² из годового листа (для вкладки эффективности)
  apWithTo: number | null;
  toPeriodCur: number | null;   // ТО за доступный период этого года (YTD)
  curMonths: number;            // сколько месяцев с данными в этом году
  periodMin: number | null;     // первый месяц периода (1..12)
  periodMax: number | null;     // последний месяц периода
  curMatched: number | null;    // ТО этого года за месяцы, совпавшие с пред. годом
  prevMatched: number | null;   // ТО пред. года за те же месяцы
  matchedMonths: number;        // сколько месяцев сопоставлено
  // Поведенческие метрики из Focus (касса) за тот же год, если магазин сматчен.
  focusAvgCheck: number | null;     // средний чек, ₽ (взвешенный по числу чеков)
  focusReceipts: number | null;     // суммарное число чеков за период
  focusSalesPerM2: number | null;   // средние продажи/м² за период
}

export function getTenantPeriodYoY(year: number): TenantPeriodRow[] {
  return db()
    .prepare(`
      WITH cur AS (
        SELECT store_name, month, to_sum
        FROM turnover_monthly
        WHERE year = ? AND to_sum IS NOT NULL
      ),
      prev AS (
        SELECT store_name, month, to_sum
        FROM turnover_monthly
        WHERE year = ? AND to_sum IS NOT NULL
      ),
      cur_agg AS (
        SELECT store_name,
               SUM(to_sum) AS cur_period,
               COUNT(*)    AS cur_months,
               MIN(month)  AS m_min,
               MAX(month)  AS m_max
        FROM cur GROUP BY store_name
      ),
      matched AS (
        SELECT c.store_name,
               SUM(c.to_sum) AS cur_matched,
               SUM(p.to_sum) AS prev_matched,
               COUNT(*)      AS matched_months
        FROM cur c
        JOIN prev p ON p.store_name = c.store_name AND p.month = c.month
        GROUP BY c.store_name
      ),
      focus_agg AS (
        SELECT store_name,
               SUM(receipts) AS f_receipts,
               CASE WHEN SUM(receipts) > 0
                    THEN SUM(avg_check * receipts) / SUM(receipts)
                    ELSE NULL END AS f_avg_check,
               AVG(sales_per_m2) AS f_sales_per_m2
        FROM focus_monthly
        WHERE year = ? AND store_name IS NOT NULL
        GROUP BY store_name
      )
      SELECT y.store_name           AS storeName,
             y.arendator            AS arendator,
             y.category             AS category,
             y.area_m2              AS areaM2,
             y.to_per_m2            AS toPerM2,
             y.ap_with_to           AS apWithTo,
             ca.cur_period          AS toPeriodCur,
             COALESCE(ca.cur_months, 0) AS curMonths,
             ca.m_min               AS periodMin,
             ca.m_max               AS periodMax,
             mt.cur_matched         AS curMatched,
             mt.prev_matched        AS prevMatched,
             COALESCE(mt.matched_months, 0) AS matchedMonths,
             fa.f_avg_check         AS focusAvgCheck,
             fa.f_receipts          AS focusReceipts,
             fa.f_sales_per_m2      AS focusSalesPerM2
      FROM turnover_yearly y
      LEFT JOIN cur_agg ca   ON ca.store_name = y.store_name
      LEFT JOIN matched mt   ON mt.store_name = y.store_name
      LEFT JOIN focus_agg fa ON fa.store_name = y.store_name
      WHERE y.year = ?
      ORDER BY ca.cur_period DESC NULLS LAST, y.store_name
    `)
    .all(year, year - 1, year, year) as unknown as TenantPeriodRow[];
}

// Помесячная история метрик Focus по магазину (для карточки магазина).
export interface StoreFocusPoint {
  year: number;
  month: number;
  avgCheck: number | null;
  receipts: number | null;
  salesPerM2: number | null;
  returns: number | null;
}
export function getStoreFocusTimeline(storeName: string): StoreFocusPoint[] {
  return db()
    .prepare(`
      SELECT year, month,
             avg_check    AS avgCheck,
             receipts     AS receipts,
             sales_per_m2 AS salesPerM2,
             returns      AS returns
      FROM focus_monthly
      WHERE store_name = ?
      ORDER BY year, month
    `)
    .all(storeName) as unknown as StoreFocusPoint[];
}

// ── Сезонные тепловые карты: общая строка-матрица для трёх режимов ─────
//   • по магазинам (getYearStoreMonthlyMatrix, уже есть)
//   • по годам      (getYearMonthHeat)      — годы × месяцы по всему ТРЦ
//   • по категориям (getCategoryMonthHeat)  — категории × месяцы за год
// Цвет ячейки на фронте — индекс месяца к среднему по строке, поэтому
// строки разного масштаба сравниваются в одной шкале.
export interface HeatRow {
  label: string;
  sublabel: string | null;
  m: (number | null)[];   // 12 элементов, индекс 0 = январь
  total: number;          // сумма за строку (для метрики to_sum) или средн.
}

type HeatMetric = 'to_sum' | 'to_per_m2';

function pivotHeat(
  rows: { key: string; sub: string | null; month: number; v: number | null }[],
  metric: HeatMetric,
): HeatRow[] {
  const map = new Map<string, HeatRow>();
  const order: string[] = [];
  for (const r of rows) {
    let row = map.get(r.key);
    if (!row) {
      row = { label: r.key, sublabel: r.sub, m: Array(12).fill(null), total: 0 };
      map.set(r.key, row);
      order.push(r.key);
    }
    if (r.month >= 1 && r.month <= 12) row.m[r.month - 1] = r.v;
  }
  // total: для to_sum — сумма за год; для to_per_m2 — среднее по месяцам.
  for (const row of map.values()) {
    const vals = row.m.filter((x): x is number => x != null);
    row.total = metric === 'to_per_m2'
      ? (vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0)
      : vals.reduce((s, x) => s + x, 0);
  }
  return order.map(k => map.get(k)!).sort((a, b) => b.total - a.total);
}

// Годы × месяцы — весь ТРЦ. Для to_sum: сумма ТО всех магазинов за месяц;
// для to_per_m2: средний ТО/м² по магазинам. Строки — годы (свежие сверху).
export function getYearMonthHeat(metric: HeatMetric = 'to_sum'): HeatRow[] {
  const agg = metric === 'to_per_m2' ? 'AVG(to_per_m2)' : 'SUM(to_sum)';
  const rows = db()
    .prepare(`
      SELECT year AS y, month AS month, ${agg} AS v
      FROM turnover_monthly
      WHERE ${metric === 'to_per_m2' ? 'to_per_m2' : 'to_sum'} IS NOT NULL
      GROUP BY year, month
      ORDER BY year DESC, month
    `)
    .all() as { y: number; month: number; v: number | null }[];
  const mapped = rows.map(r => ({ key: String(r.y), sub: null, month: r.month, v: r.v }));
  // Для годов сортируем по году (свежие сверху), а не по total.
  const heat = pivotHeat(mapped, metric);
  return heat.sort((a, b) => Number(b.label) - Number(a.label));
}

// Категории × месяцы за конкретный год.
export function getCategoryMonthHeat(year: number, metric: HeatMetric = 'to_sum'): HeatRow[] {
  const agg = metric === 'to_per_m2' ? 'AVG(to_per_m2)' : 'SUM(to_sum)';
  const rows = db()
    .prepare(`
      SELECT COALESCE(NULLIF(TRIM(category), ''), '— без категории') AS cat,
             month AS month, ${agg} AS v,
             COUNT(DISTINCT store_name) AS stores
      FROM turnover_monthly
      WHERE year = ? AND ${metric === 'to_per_m2' ? 'to_per_m2' : 'to_sum'} IS NOT NULL
      GROUP BY cat, month
      ORDER BY cat, month
    `)
    .all(year) as { cat: string; month: number; v: number | null; stores: number }[];
  // Считаем число магазинов в категории для подписи.
  const storeCount = new Map<string, number>();
  for (const r of rows) {
    storeCount.set(r.cat, Math.max(storeCount.get(r.cat) ?? 0, r.stores));
  }
  const mapped = rows.map(r => ({
    key: r.cat,
    sub: `${storeCount.get(r.cat) ?? 0} маг.`,
    month: r.month, v: r.v,
  }));
  return pivotHeat(mapped, metric);
}
