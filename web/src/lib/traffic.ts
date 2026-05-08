import { getPool, sql } from './mssql';

export const FLOOR1_ZONE    = 172487777;
export const FLOOR2_ZONE    = 74145577;
export const FLOOR4_ZONE    = 82295957;   // в БД "3 этаж", фактически подъёмы 3→4
export const PERIMETER_ZONE = 127479461;
export const FLOOR3_VIRTUAL = -3;

export interface Zone {
  id: number;
  name: string;
  color: string;
  icon: string;
}

export const ZONES: Zone[] = [
  { id: PERIMETER_ZONE, name: 'Периметр', color: '#6366f1', icon: 'P' },
  { id: FLOOR1_ZONE,    name: '1 этаж',   color: '#60a5fa', icon: '1' },
  { id: FLOOR2_ZONE,    name: '2 этаж',   color: '#34d399', icon: '2' },
  { id: FLOOR3_VIRTUAL, name: '3 этаж',   color: '#fbbf24', icon: '3' },
  { id: FLOOR4_ZONE,    name: '4 этаж',   color: '#f97316', icon: '4' },
];

// Counter override: 149430018 "Вход №2 (-2 этаж лифт)" перенесён, его трафик → 1 этаж.
export const EFFECTIVE_ZONE = `
  CASE WHEN cze.ID_Enter = 149430018 AND cze.ID_Zone = 163317603
       THEN 172487777 ELSE cze.ID_Zone END
`;

export function synthFloor3Flat<T extends number | null | undefined>(
  map: Record<number, T>,
  zero: T,
): Record<number, T> {
  const f2 = (map[FLOOR2_ZONE] ?? zero) as number;
  const f4 = (map[FLOOR4_ZONE] ?? zero) as number;
  (map as any)[FLOOR3_VIRTUAL] = Math.max(0, (f2 || 0) - (f4 || 0));
  return map;
}

export function synthFloor3Nested(
  map: Record<number, Record<string | number, number>>,
): Record<number, Record<string | number, number>> {
  const f2 = map[FLOOR2_ZONE] ?? {};
  const f4 = map[FLOOR4_ZONE] ?? {};
  const keys = new Set<string | number>([
    ...Object.keys(f2),
    ...Object.keys(f4),
  ]);
  const out: Record<string | number, number> = {};
  for (const k of keys) {
    out[k] = Math.max(0, (f2[k as any] ?? 0) - (f4[k as any] ?? 0));
  }
  map[FLOOR3_VIRTUAL] = out;
  return map;
}

// ── Live counter ─────────────────────────────────────────────────────────
// Flask traffic_app.py:235 uses raw `max(0, ins − outs)`, which sinks to 0
// every evening because the perimeter IR sensors slightly over-count exits.
// We discount today's outs by the actual 7-day ins/outs ratio: if exits
// over-count by 5 %, k ≈ 0.95 and we subtract 5 % less than raw outs.
// Cap at 1.0 — outs sensors can't physically register fewer crossings than
// reality, so k > 1 would only mean an entry sensor is underperforming and
// no correction is appropriate.
//
// Earlier this had a hardcoded clamp [0.65, 0.85], which over-corrected
// roughly threefold on real data (true ratio observed ~0.95) and produced
// inflated occupancy mid-day.
export interface LiveData {
  inside: number;
  insToday: number;
  outsToday: number;
  asOf: string | null;
  date: string;
}

export async function getLive(): Promise<LiveData> {
  const pool = await getPool();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [todayRes, calRes] = await Promise.all([
    pool.request()
      .input('start', sql.DateTime, today)
      .input('end',   sql.DateTime, tomorrow)
      .query(`
        SELECT
          SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn  ELSE 0 END) AS ins,
          SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumOut ELSE 0 END) AS outs,
          MAX(s.TimeRecord) AS last
        FROM CM_StorageEnter s
        JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
        WHERE cze.ID_Zone = ${PERIMETER_ZONE}
          AND s.TimeRecord >= @start AND s.TimeRecord < @end
      `),
    pool.request()
      .input('start', sql.DateTime, weekAgo)
      .input('end',   sql.DateTime, today)
      .query(`
        SELECT
          SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn  ELSE 0 END) AS ins7,
          SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumOut ELSE 0 END) AS outs7
        FROM CM_StorageEnter s
        JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
        WHERE cze.ID_Zone = ${PERIMETER_ZONE}
          AND s.TimeRecord >= @start AND s.TimeRecord < @end
      `),
  ]);

  const row  = todayRes.recordset[0] ?? {};
  const cal  = calRes.recordset[0] ?? {};
  const ins  = Number(row.ins  ?? 0) || 0;
  const outs = Number(row.outs ?? 0) || 0;
  const ins7  = Number(cal.ins7  ?? 0) || 0;
  const outs7 = Number(cal.outs7 ?? 0) || 0;
  const last: Date | null = row.last ?? null;

  let k = outs7 > 0 ? ins7 / outs7 : 1.0;
  if (!Number.isFinite(k)) k = 1.0;
  k = Math.min(1.0, k);

  const fmtDate = today.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return {
    inside: Math.max(0, Math.round(ins - outs * k)),
    insToday: ins,
    outsToday: outs,
    asOf: last ? last.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null,
    date: fmtDate,
  };
}

// ── Zone totals + daily breakdown for a date range ──────────────────────
export interface ZoneTotal {
  id: number;
  name: string;
  total: number;
}
export interface RangeResult {
  totals: ZoneTotal[];
  dates: string[];                       // ['YYYY-MM-DD', ...] aligned with daily[]
  daily: Record<number, number[]>;       // zoneId -> values aligned with dates[]
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getRange(start: Date, end: Date): Promise<RangeResult> {
  const pool = await getPool();
  const r = await pool.request()
    .input('start', sql.DateTime, start)
    .input('end',   sql.DateTime, end)
    .query(`
      SELECT CAST(s.TimeRecord AS DATE) AS d,
        ${EFFECTIVE_ZONE} AS ID_Zone,
        SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn
                 WHEN cze.ID_Vector=2 THEN s.SumOut ELSE 0 END) AS v
      FROM CM_StorageStatusEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE s.Status IN (1,2)
        AND s.TimeRecord >= @start AND s.TimeRecord < @end
      GROUP BY CAST(s.TimeRecord AS DATE), ${EFFECTIVE_ZONE}
      ORDER BY d
    `);

  // Dense date axis — start inclusive, end exclusive.
  const dates: string[] = [];
  for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    dates.push(isoLocal(d));
  }

  // zoneId -> dateStr -> value
  const nested: Record<number, Record<string, number>> = {};
  for (const row of r.recordset) {
    const z = Number(row.ID_Zone);
    const d = row.d instanceof Date ? isoLocal(row.d) : String(row.d).slice(0, 10);
    (nested[z] ??= {})[d] = Number(row.v) || 0;
  }

  // Synthesize 3rd floor per-day: floor2 - floor4.
  const f2 = nested[FLOOR2_ZONE] ?? {};
  const f4 = nested[FLOOR4_ZONE] ?? {};
  const f3: Record<string, number> = {};
  for (const d of dates) f3[d] = Math.max(0, (f2[d] ?? 0) - (f4[d] ?? 0));
  nested[FLOOR3_VIRTUAL] = f3;

  const daily: Record<number, number[]> = {};
  const totals: ZoneTotal[] = [];
  for (const z of ZONES) {
    const arr = dates.map(d => nested[z.id]?.[d] ?? 0);
    daily[z.id] = arr;
    totals.push({ id: z.id, name: z.name, total: arr.reduce((a, b) => a + b, 0) });
  }
  return { totals, dates, daily };
}

// Legacy alias — kept for any old imports; returns just the zone totals.
export async function getRangeTotals(start: Date, end: Date): Promise<ZoneTotal[]> {
  const { totals } = await getRange(start, end);
  return totals;
}

// ── Hourly averages for a date range ─────────────────────────────────────
export async function getHourlyAvg(start: Date, end: Date): Promise<Record<number, number[]>> {
  const pool = await getPool();
  const r = await pool.request()
    .input('start', sql.DateTime, start)
    .input('end',   sql.DateTime, end)
    .query(`
      SELECT ${EFFECTIVE_ZONE} AS ID_Zone,
        DATEPART(HOUR, s.TimeRecord) AS h,
        SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn
                 WHEN cze.ID_Vector=2 THEN s.SumOut ELSE 0 END) AS v
      FROM CM_StorageEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE s.TimeRecord >= @start AND s.TimeRecord < @end
      GROUP BY ${EFFECTIVE_ZONE}, DATEPART(HOUR, s.TimeRecord)
    `);
  const nested: Record<number, Record<number, number>> = {};
  for (const row of r.recordset) {
    const z = Number(row.ID_Zone);
    const h = Number(row.h);
    (nested[z] ??= {})[h] = Number(row.v) || 0;
  }
  synthFloor3Nested(nested as any);

  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  const result: Record<number, number[]> = {};
  for (const z of ZONES) {
    const arr = Array.from({ length: 24 }, (_, h) => (nested[z.id]?.[h] ?? 0) / days);
    result[z.id] = arr.map(v => Math.round(v * 10) / 10);
  }
  return result;
}

// ── Monthly totals for a year ────────────────────────────────────────────
export async function getMonthly(year: number): Promise<Record<number, number[]>> {
  const pool = await getPool();
  const r = await pool.request()
    .input('year', sql.Int, year)
    .query(`
      SELECT ${EFFECTIVE_ZONE} AS ID_Zone,
        MONTH(s.TimeRecord) AS m,
        SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn
                 WHEN cze.ID_Vector=2 THEN s.SumOut ELSE 0 END) AS v
      FROM CM_StorageStatusEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE s.Status IN (1,2)
        AND YEAR(s.TimeRecord) = @year
      GROUP BY ${EFFECTIVE_ZONE}, MONTH(s.TimeRecord)
    `);
  const nested: Record<number, Record<number, number>> = {};
  for (const row of r.recordset) {
    const z = Number(row.ID_Zone);
    const m = Number(row.m);
    (nested[z] ??= {})[m] = Number(row.v) || 0;
  }
  synthFloor3Nested(nested as any);

  const result: Record<number, number[]> = {};
  for (const z of ZONES) {
    result[z.id] = Array.from({ length: 12 }, (_, i) => nested[z.id]?.[i + 1] ?? 0);
  }
  return result;
}
