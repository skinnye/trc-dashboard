/**
 * Aggregated reads from SQLite for rent APIs.
 *
 * Two data sources coexist in dashboard.db:
 *  - **Legacy Python tables** (`monthly_totals`, `tenant_payments`, `payment_log`)
 *    are written by `poll.py`/`app.py` every ~5 minutes. Always fresh.
 *  - **Next.js extended tables** (`rent_daily`, `dec_reference`, `rent_changes`,
 *    `monthly_totals_ext`) are written daily by our scheduler. Have richer
 *    room-level columns (floor/area/rate) the legacy tables lack.
 *
 * Strategy: read aggregates that exist in legacy from there (fresh), and only
 * fall back to the extended tables for room-level detail (rooms/lost-revenue).
 */
import { db, latestSnapshotDate } from './db';

function normLegal(s: string | null | undefined): string {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface SnapshotMeta {
  date: string;
  capturedAt: string;
}

export function getLatestMeta(): SnapshotMeta | null {
  const date = latestSnapshotDate();
  if (!date) return null;
  const row = db().prepare(`
    SELECT MAX(captured_at) AS captured_at FROM rent_daily WHERE snapshot_date = ?
  `).get(date) as unknown as { captured_at?: string };
  return { date, capturedAt: row?.captured_at ?? date };
}

// ── Summary: plan/fact per month for latest snapshot ──────────────────
export interface MonthlyTotal {
  month: number;
  planSTo: number | null;
  planBezTo: number | null;
  factSTo: number | null;
  factBezTo: number | null;
}
export function getMonthlyTotals(date: string): MonthlyTotal[] {
  return db().prepare(`
    SELECT month_num AS month,
           plan_s_to AS planSTo, plan_bez_to AS planBezTo,
           fact_s_to AS factSTo, fact_bez_to AS factBezTo
    FROM monthly_totals_ext
    WHERE snapshot_date = ? ORDER BY month_num
  `).all(date) as unknown as MonthlyTotal[];
}

// ── LEGACY: monthly totals from Python's `monthly_totals` (always fresh) ──
export function getMonthlyTotalsLegacy(): MonthlyTotal[] {
  return db().prepare(`
    SELECT month_num AS month,
           plan_s_to AS planSTo, plan_bez_to AS planBezTo,
           fact_s_to AS factSTo, fact_bez_to AS factBezTo
    FROM monthly_totals
    WHERE captured_at = (SELECT MAX(captured_at) FROM monthly_totals)
    ORDER BY month_num
  `).all() as unknown as MonthlyTotal[];
}

export function getLegacyCaptureMeta(): { capturedAt: string } | null {
  const r = db().prepare(
    `SELECT MAX(captured_at) AS captured_at FROM monthly_totals`,
  ).get() as { captured_at?: string };
  return r?.captured_at ? { capturedAt: r.captured_at } : null;
}

// ── Rooms for a specific month (latest snapshot) ──────────────────────
export interface RoomRow {
  rowNum: number | null;
  floor: string | null;
  room: string | null;
  legal: string | null;
  trade: string | null;
  status: string | null;
  area: number | null;
  rate: number | null;
  planVat: number | null;
  planOplat: number | null;
  factVat: number | null;
  factOplat: number | null;
}
export function getRoomsForMonth(date: string, month: number): RoomRow[] {
  return db().prepare(`
    SELECT row_num AS rowNum, floor, room, legal, trade, status,
           area, rate,
           plan_vat AS planVat, plan_oplat AS planOplat,
           fact_vat AS factVat, fact_oplat AS factOplat
    FROM rent_daily
    WHERE snapshot_date = ? AND month_num = ?
  `).all(date, month) as unknown as RoomRow[];
}

// ── Lost revenue: rooms «не сдан» cross-referenced vs dec_reference ──
export interface LostRevenueRow {
  floor: string | null;
  room: string | null;
  lastLegal: string | null;
  lastTrade: string | null;
  area: number | null;
  rate: number | null;
  potentialRevenue: number;
}
export function getLostRevenueForMonth(date: string, month: number): LostRevenueRow[] {
  return db().prepare(`
    SELECT rd.floor, rd.room,
           dr.legal AS lastLegal, dr.trade AS lastTrade,
           COALESCE(rd.area, dr.area) AS area,
           COALESCE(rd.rate, dr.rate) AS rate,
           COALESCE(dr.plan_vat, 0)    AS potentialRevenue
    FROM rent_daily rd
    JOIN dec_reference dr
      ON LOWER(TRIM(dr.room)) = LOWER(TRIM(rd.room))
    WHERE rd.snapshot_date = ? AND rd.month_num = ?
      AND rd.status = 'не сдан'
      AND dr.status = 'сдан'
      AND dr.plan_vat > 0
    ORDER BY potentialRevenue DESC
  `).all(date, month) as unknown as LostRevenueRow[];
}

export function getLostRevenueByMonth(date: string): Record<number, number> {
  const rows = db().prepare(`
    SELECT rd.month_num AS m, SUM(dr.plan_vat) AS s
    FROM rent_daily rd
    JOIN dec_reference dr
      ON LOWER(TRIM(dr.room)) = LOWER(TRIM(rd.room))
    WHERE rd.snapshot_date = ?
      AND rd.status = 'не сдан'
      AND dr.status = 'сдан'
      AND dr.plan_vat > 0
    GROUP BY rd.month_num
  `).all(date) as { m: number; s: number }[];
  const out: Record<number, number> = {};
  for (const r of rows) out[r.m] = r.s || 0;
  return out;
}

// ── Payment history by legal entity (across all months) ───────────────
export interface PaymentHistoryRow {
  legal: string;
  trade: string | null;
  room: string | null;
  planVat: number;
  factOplat: number;
  pct: number;
}
export function getPaymentHistoryForMonth(date: string, month: number): PaymentHistoryRow[] {
  const rows = db().prepare(`
    SELECT legal, trade, room,
           COALESCE(plan_vat, 0)   AS planVat,
           COALESCE(fact_oplat, 0) AS factOplat
    FROM rent_daily
    WHERE snapshot_date = ? AND month_num = ?
      AND status = 'сдан' AND plan_vat > 0 AND legal IS NOT NULL AND legal <> ''
    ORDER BY legal
  `).all(date, month) as any[];
  return rows.map(r => ({
    ...r,
    pct: r.planVat > 0 ? Math.round((r.factOplat / r.planVat) * 1000) / 10 : 0,
  }));
}

// ── HYBRID: plan from rent_daily (latest snapshot), fact from tenant_payments
//    (Python's fresh ~5-min capture). Aggregated per trade-name (brand).
//    `tenant_payments.tenant_name` stores BRAND/torgovoye name — must be joined
//    against `rent_daily.trade`, not `rent_daily.legal`.
export function getPaymentHistoryForMonthLegacy(date: string, month: number): PaymentHistoryRow[] {
  const planRows = db().prepare(`
    SELECT trade,
           GROUP_CONCAT(DISTINCT legal) AS legal,
           GROUP_CONCAT(DISTINCT room) AS room,
           SUM(COALESCE(plan_vat, 0)) AS planVat
    FROM rent_daily
    WHERE snapshot_date = ? AND month_num = ?
      AND status = 'сдан' AND plan_vat > 0 AND trade IS NOT NULL AND trade <> ''
    GROUP BY trade
  `).all(date, month) as any[];

  const factRows = db().prepare(`
    SELECT tenant_name AS trade, SUM(COALESCE(oplaceno_ap, 0)) AS factOplat
    FROM tenant_payments
    WHERE captured_at = (SELECT MAX(captured_at) FROM tenant_payments)
      AND month_num = ?
    GROUP BY tenant_name
  `).all(month) as any[];

  const factMap = new Map<string, number>();
  for (const r of factRows) {
    factMap.set(normLegal(r.trade), Number(r.factOplat) || 0);
  }

  return planRows.map(r => {
    const fact = factMap.get(normLegal(r.trade)) ?? 0;
    const plan = Number(r.planVat) || 0;
    return {
      legal: r.legal ?? '',  // юр.лицо (может быть несколько через запятую)
      trade: r.trade,        // бренд — основной идентификатор
      room:  r.room,
      planVat: Math.round(plan),
      factOplat: Math.round(fact),
      pct: plan > 0 ? Math.round((fact / plan) * 1000) / 10 : 0,
    };
  });
}

// ── Rating (discipline) — per legal across all available months ───────
export interface RatingRow {
  legal: string;
  trade: string | null;
  room: string | null;
  paid: number;
  total: number;
  pct: number;
  plan: number;
  fact: number;
  debt: number;
  streak: number;
  missed: number[];
}
export function getRating(date: string): {
  months: number[]; inProgress: number[];
  stable: RatingRow[]; unstable: RatingRow[];
} {
  const conn = db();
  // months with any fact > 0 for this snapshot
  const monthsWithData = (conn.prepare(`
    SELECT DISTINCT month_num AS m FROM rent_daily
    WHERE snapshot_date = ? AND fact_s_to_exists = 1
  `.replace('fact_s_to_exists = 1', 'fact_oplat > 0')).all(date) as any[])
    .map(r => r.m as number).sort((a, b) => a - b);

  // inProgress: месяцы, где оплатило < 40%
  const inProgress: number[] = [];
  for (const m of monthsWithData) {
    const tot = (conn.prepare(`
      SELECT COUNT(*) AS n FROM rent_daily
      WHERE snapshot_date = ? AND month_num = ? AND status = 'сдан' AND plan_vat > 0
    `).get(date, m) as any).n as number;
    const paid = (conn.prepare(`
      SELECT COUNT(*) AS n FROM rent_daily
      WHERE snapshot_date = ? AND month_num = ? AND status = 'сдан' AND plan_vat > 0 AND fact_oplat > 0
    `).get(date, m) as any).n as number;
    if (tot > 0 && paid / tot < 0.40) inProgress.push(m);
  }
  const analysis = monthsWithData.filter(m => !inProgress.includes(m));
  const activeMonths = analysis.length ? analysis : monthsWithData;
  if (activeMonths.length === 0) return { months: [], inProgress, stable: [], unstable: [] };

  const placeholders = activeMonths.map(() => '?').join(',');
  const rows = conn.prepare(`
    SELECT legal, trade, room, month_num AS m,
           COALESCE(plan_vat, 0) AS plan, COALESCE(fact_oplat, 0) AS fact
    FROM rent_daily
    WHERE snapshot_date = ?
      AND month_num IN (${placeholders})
      AND status = 'сдан' AND plan_vat > 0 AND legal IS NOT NULL AND legal <> ''
    ORDER BY legal, m
  `).all(date, ...activeMonths) as any[];

  type Agg = { legal: string; trade: string; room: string; entries: { m: number; plan: number; fact: number }[] };
  const byLegal = new Map<string, Agg>();
  for (const r of rows) {
    if (!byLegal.has(r.legal)) byLegal.set(r.legal, { legal: r.legal, trade: r.trade, room: r.room, entries: [] });
    byLegal.get(r.legal)!.entries.push({ m: r.m, plan: r.plan, fact: r.fact });
    byLegal.get(r.legal)!.trade = r.trade; // last wins
    byLegal.get(r.legal)!.room  = r.room;
  }

  const stable: RatingRow[] = [];
  const unstable: RatingRow[] = [];
  for (const { legal, trade, room, entries } of byLegal.values()) {
    entries.sort((a, b) => a.m - b.m);
    const paid  = entries.filter(e => e.fact > 0).length;
    const total = entries.length;
    const missed = entries.filter(e => e.fact === 0).map(e => e.m);
    let streak = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].fact === 0) streak++; else break;
    }
    const planSum = entries.reduce((s, e) => s + e.plan, 0);
    const factSum = entries.reduce((s, e) => s + e.fact, 0);
    const row: RatingRow = {
      legal, trade, room,
      paid, total,
      pct: Math.round((paid / total) * 1000) / 10,
      plan: Math.round(planSum),
      fact: Math.round(factSum),
      debt: Math.round(planSum - factSum),
      streak, missed,
    };
    (paid === total ? stable : unstable).push(row);
  }
  unstable.sort((a, b) => b.debt - a.debt);
  stable.sort((a, b) => a.legal.localeCompare(b.legal, 'ru'));

  return { months: activeMonths, inProgress, stable, unstable };
}

// ── HYBRID rating: plan from rent_daily (latest), fact from tenant_payments. ─
//    Aggregated per `trade` (brand name) — that's what tenant_payments stores.
export function getRatingLegacy(date: string): {
  months: number[]; inProgress: number[];
  stable: RatingRow[]; unstable: RatingRow[];
} {
  const conn = db();

  // Plan per (month, trade) — from latest rent_daily snapshot.
  const planRows = conn.prepare(`
    SELECT month_num AS m, trade,
           GROUP_CONCAT(DISTINCT legal) AS legal,
           GROUP_CONCAT(DISTINCT room) AS room,
           SUM(COALESCE(plan_vat, 0)) AS plan
    FROM rent_daily
    WHERE snapshot_date = ?
      AND status = 'сдан' AND plan_vat > 0 AND trade IS NOT NULL AND trade <> ''
    GROUP BY month_num, trade
    ORDER BY trade, m
  `).all(date) as any[];

  // Fact per (month, trade) — from latest tenant_payments capture.
  const factRows = conn.prepare(`
    SELECT month_num AS m, tenant_name AS trade,
           SUM(COALESCE(oplaceno_ap, 0)) AS fact
    FROM tenant_payments
    WHERE captured_at = (SELECT MAX(captured_at) FROM tenant_payments)
    GROUP BY month_num, tenant_name
  `).all() as any[];

  const factMap = new Map<string, number>();
  for (const f of factRows) factMap.set(`${f.m}|${normLegal(f.trade)}`, Number(f.fact) || 0);

  // Months with any plan>0 in the snapshot.
  const monthsWithData = Array.from(new Set(planRows.map(r => r.m as number))).sort((a, b) => a - b);

  // inProgress = месяцы где паю-листов оплачено меньше 40 %.
  const inProgress: number[] = [];
  for (const m of monthsWithData) {
    const planForMonth = planRows.filter(r => r.m === m);
    const total = planForMonth.length;
    const paid = planForMonth.filter(r => (factMap.get(`${m}|${normLegal(r.trade)}`) ?? 0) > 0).length;
    if (total > 0 && paid / total < 0.40) inProgress.push(m);
  }
  const analysis = monthsWithData.filter(m => !inProgress.includes(m));
  const activeMonths = analysis.length ? analysis : monthsWithData;
  if (activeMonths.length === 0) return { months: [], inProgress, stable: [], unstable: [] };

  type Agg = { legal: string; trade: string; room: string;
               entries: { m: number; plan: number; fact: number }[] };
  const byTrade = new Map<string, Agg>();
  for (const r of planRows) {
    if (!activeMonths.includes(r.m)) continue;
    const fact = factMap.get(`${r.m}|${normLegal(r.trade)}`) ?? 0;
    if (!byTrade.has(r.trade)) byTrade.set(r.trade, { legal: r.legal ?? '', trade: r.trade, room: r.room, entries: [] });
    const a = byTrade.get(r.trade)!;
    a.entries.push({ m: r.m, plan: Number(r.plan) || 0, fact });
    a.legal = r.legal ?? a.legal; a.room = r.room;
  }

  const stable: RatingRow[] = [];
  const unstable: RatingRow[] = [];
  for (const { legal, trade, room, entries } of byTrade.values()) {
    entries.sort((a, b) => a.m - b.m);
    const paid  = entries.filter(e => e.fact > 0).length;
    const total = entries.length;
    const missed = entries.filter(e => e.fact === 0).map(e => e.m);
    let streak = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].fact === 0) streak++; else break;
    }
    const planSum = entries.reduce((s, e) => s + e.plan, 0);
    const factSum = entries.reduce((s, e) => s + e.fact, 0);
    const row: RatingRow = {
      legal, trade, room,
      paid, total,
      pct: Math.round((paid / total) * 1000) / 10,
      plan: Math.round(planSum),
      fact: Math.round(factSum),
      debt: Math.round(planSum - factSum),
      streak, missed,
    };
    (paid === total ? stable : unstable).push(row);
  }
  unstable.sort((a, b) => b.debt - a.debt);
  stable.sort((a, b) => a.legal.localeCompare(b.legal, 'ru'));

  return { months: activeMonths, inProgress, stable, unstable };
}

// ── LEGACY: payment change log from Python's `payment_log` ────────────
export interface PaymentLogRow {
  detectedAt: string;
  monthNum: number;
  monthName: string | null;
  legal: string;
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
}
export function getPaymentLog(sinceDate?: string): PaymentLogRow[] {
  const where = sinceDate ? `WHERE detected_at >= ?` : '';
  const args = sinceDate ? [sinceDate] : [];
  return db().prepare(`
    SELECT detected_at AS detectedAt,
           month_num   AS monthNum,
           month_name  AS monthName,
           tenant_name AS legal,
           old_value   AS oldValue,
           new_value   AS newValue,
           delta
    FROM payment_log ${where}
    ORDER BY id DESC
    LIMIT 500
  `).all(...args) as unknown as PaymentLogRow[];
}

// ── TENANT directory: list with план/факт for a given month + comments ──
export interface TenantRow {
  trade: string;            // бренд (ключ)
  legal: string | null;     // юр.лицо (может быть несколько через запятую)
  floor: string | null;
  rooms: string | null;     // через запятую если несколько
  status: string | null;    // 'сдан' / 'не сдан'
  plan: number;
  fact: number;
  pct: number;
  comment: string | null;
  commentUpdatedAt: string | null;
}

export function getTenantsForMonth(date: string, month: number): TenantRow[] {
  const conn = db();
  const planRows = conn.prepare(`
    SELECT trade,
           GROUP_CONCAT(DISTINCT legal) AS legal,
           MIN(floor) AS floor,
           GROUP_CONCAT(DISTINCT room) AS rooms,
           MIN(status) AS status,
           SUM(COALESCE(plan_vat, 0)) AS plan
    FROM rent_daily
    WHERE snapshot_date = ? AND month_num = ?
      AND trade IS NOT NULL AND trade <> ''
    GROUP BY trade
    ORDER BY floor, trade
  `).all(date, month) as any[];

  const factRows = conn.prepare(`
    SELECT tenant_name AS trade, SUM(COALESCE(oplaceno_ap, 0)) AS fact
    FROM tenant_payments
    WHERE captured_at = (SELECT MAX(captured_at) FROM tenant_payments)
      AND month_num = ?
    GROUP BY tenant_name
  `).all(month) as any[];

  const factMap = new Map<string, number>();
  for (const r of factRows) factMap.set(normLegal(r.trade), Number(r.fact) || 0);

  const commentRows = conn.prepare(
    `SELECT trade, comment, updated_at FROM tenant_comments`
  ).all() as any[];
  const commentMap = new Map<string, { comment: string; updatedAt: string }>();
  for (const c of commentRows) {
    if (c.comment) commentMap.set(normLegal(c.trade), { comment: c.comment, updatedAt: c.updated_at });
  }

  return planRows.map(r => {
    const fact = factMap.get(normLegal(r.trade)) ?? 0;
    const plan = Number(r.plan) || 0;
    const c = commentMap.get(normLegal(r.trade));
    return {
      trade: r.trade,
      legal: r.legal,
      floor: r.floor,
      rooms: r.rooms,
      status: r.status,
      plan: Math.round(plan),
      fact: Math.round(fact),
      pct: plan > 0 ? Math.round((fact / plan) * 1000) / 10 : 0,
      comment: c?.comment ?? null,
      commentUpdatedAt: c?.updatedAt ?? null,
    };
  });
}

export function setTenantComment(trade: string, comment: string): void {
  const cleaned = comment.trim();
  const conn = db();
  if (cleaned === '') {
    conn.prepare(`DELETE FROM tenant_comments WHERE trade = ?`).run(trade);
    return;
  }
  conn.prepare(`
    INSERT INTO tenant_comments (trade, comment, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(trade) DO UPDATE SET
      comment    = excluded.comment,
      updated_at = excluded.updated_at
  `).run(trade, cleaned);
}

// ── Changes over a date range ──────────────────────────────────────────
export interface ChangeRow {
  detectedAt: string;
  snapshotDate: string;
  monthNum: number;
  kind: string;
  floor: string | null;
  room: string | null;
  prevLegal: string | null;
  nextLegal: string | null;
  prevRate: number | null;
  nextRate: number | null;
  prevStatus: string | null;
  nextStatus: string | null;
}
export function getChanges(sinceDate?: string): ChangeRow[] {
  const conn = db();
  const where = sinceDate ? 'WHERE snapshot_date >= ?' : '';
  const args = sinceDate ? [sinceDate] : [];
  return conn.prepare(`
    SELECT detected_at   AS detectedAt,
           snapshot_date AS snapshotDate,
           month_num     AS monthNum,
           kind, floor, room,
           prev_legal    AS prevLegal,  next_legal   AS nextLegal,
           prev_rate     AS prevRate,   next_rate    AS nextRate,
           prev_status   AS prevStatus, next_status  AS nextStatus
    FROM rent_changes ${where}
    ORDER BY snapshot_date DESC, id DESC
    LIMIT 500
  `).all(...args) as unknown as ChangeRow[];
}
