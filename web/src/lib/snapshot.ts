/**
 * Snapshot orchestrator:
 *   1) read Excel (forced re-read)
 *   2) persist full per-room state into `rent_daily`
 *   3) persist monthly totals into `monthly_totals_ext`
 *   4) refresh `dec_reference`
 *   5) diff vs previous snapshot → `rent_changes`
 *
 * Called by cron at 17:00 MSK and by the manual "Обновить" button.
 */
import { getRentData } from './excel';
import { db, localDate, localIsoDateTime, latestSnapshotDate } from './db';
import { MONTH_NAMES_RU } from './config';

// Mirror of Python's MIN_TENANT_PAYMENT in app.py — only paying tenants land
// in `tenant_payments`. Keep values aligned so legacy and Next.js writes are
// indistinguishable to readers.
const MIN_TENANT_PAYMENT = 100;

export interface SnapshotResult {
  date: string;
  totalRows: number;
  changesCount: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

let _running = false;

export async function takeSnapshot(): Promise<SnapshotResult> {
  if (_running) return { date: localDate(), totalRows: 0, changesCount: 0, durationMs: 0, ok: false, error: 'already running' };
  _running = true;
  const t0 = Date.now();
  const snapshotDate = localDate();
  const capturedAt = localIsoDateTime();

  try {
    const d = await getRentData(true);
    if (d.error) throw new Error(d.error);

    const conn = db();
    conn.exec('BEGIN');

    // Clean existing rows for today (idempotent re-run)
    conn.prepare('DELETE FROM rent_daily WHERE snapshot_date = ?').run(snapshotDate);
    conn.prepare('DELETE FROM monthly_totals_ext WHERE snapshot_date = ?').run(snapshotDate);

    // ── rent_daily ────────────────────────────────────────────────
    const insRent = conn.prepare(`
      INSERT INTO rent_daily
        (captured_at, snapshot_date, month_num, row_num, floor, room, legal, trade, status,
         area, rate, plan_vat, plan_oplat, fact_vat, fact_oplat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const all = [...(d.rented[m] ?? []), ...(d.notRented[m] ?? [])];
      for (const t of all) {
        insRent.run(
          capturedAt, snapshotDate, m, t.rowNum,
          t.floor, t.room, t.legal, t.trade, t.status,
          t.area, t.rate, t.planVat, t.planOplat, t.factVat, t.factOplat,
        );
        total++;
      }
    }

    // ── monthly_totals_ext ────────────────────────────────────────
    const insTot = conn.prepare(`
      INSERT INTO monthly_totals_ext
        (captured_at, snapshot_date, month_num, plan_s_to, plan_bez_to, fact_s_to, fact_bez_to)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // Also write to legacy `monthly_totals` so the dashboard's "обновлено"
    // timestamp and summary reflect this manual refresh — the summary API
    // reads from the legacy table (populated by poll.py), so without this
    // the button would update extended tables but the UI would still show
    // the timestamp of the last poll.py run.
    const insLegacyTot = conn.prepare(`
      INSERT INTO monthly_totals
        (captured_at, month_num, plan_s_to, plan_bez_to, fact_s_to, fact_bez_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let m = 1; m <= 12; m++) {
      const p = d.plan[m] ?? { sTo: null, bezTo: null };
      const f = d.fact[m] ?? { sTo: null, bezTo: null };
      insTot.run(capturedAt, snapshotDate, m, p.sTo, p.bezTo, f.sTo, f.bezTo);
      insLegacyTot.run(capturedAt, m, p.sTo, p.bezTo, f.sTo, f.bezTo);
    }

    // ── tenant_payments + payment_log (legacy, written by poll.py) ───
    // Same tables drive the Tenants / Discipline / History tabs and the
    // changes feed. Without writes here, the manual refresh would update
    // monthly totals but those tabs would still show stale data and
    // payment-log entries would only appear when poll.py next runs.
    // Logic mirrors app.py:save_snapshot.
    const isFirstPaymentRun =
      (conn.prepare('SELECT COUNT(*) AS n FROM tenant_payments').get() as { n: number }).n === 0;
    const insPay = conn.prepare(`
      INSERT INTO tenant_payments (captured_at, month_num, row_num, tenant_name, oplaceno_ap)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insLog = conn.prepare(`
      INSERT INTO payment_log
        (detected_at, month_num, month_name, tenant_name, old_value, new_value, delta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const prevPayStmt = conn.prepare(`
      SELECT row_num, oplaceno_ap FROM tenant_payments
      WHERE month_num = ? AND captured_at = (
        SELECT MAX(captured_at) FROM tenant_payments
        WHERE month_num = ? AND captured_at < ?
      )
    `);
    for (let m = 1; m <= 12; m++) {
      const monthTenants = [...(d.rented[m] ?? []), ...(d.notRented[m] ?? [])];
      const prev = new Map<number, number>();
      for (const r of prevPayStmt.all(m, m, capturedAt) as { row_num: number; oplaceno_ap: number }[]) {
        prev.set(r.row_num, r.oplaceno_ap);
      }
      for (const t of monthTenants) {
        const paid = t.factOplat;
        if (paid == null || paid < MIN_TENANT_PAYMENT) continue;
        const name = (t.trade || t.legal || '').trim();
        if (!name) continue;
        insPay.run(capturedAt, m, t.rowNum, name, paid);
        if (isFirstPaymentRun) continue;
        const ov = prev.get(t.rowNum);
        if (ov === undefined) {
          insLog.run(capturedAt, m, MONTH_NAMES_RU[m], name, null, paid, paid);
        } else if (Math.abs(paid - ov) > 1) {
          insLog.run(capturedAt, m, MONTH_NAMES_RU[m], name, ov, paid, paid - ov);
        }
      }
    }

    // ── dec_reference ─────────────────────────────────────────────
    conn.prepare('DELETE FROM dec_reference').run();
    const insDec = conn.prepare(`
      INSERT INTO dec_reference (room, legal, trade, status, area, rate, plan_vat)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [room, info] of d.dec.rooms) {
      insDec.run(room, info.legal, info.trade, info.status, info.area, info.rate, info.planVat);
    }

    conn.exec('COMMIT');

    // ── diff vs previous snapshot ─────────────────────────────────
    const changes = computeChanges(snapshotDate);

    return { date: snapshotDate, totalRows: total, changesCount: changes, durationMs: Date.now() - t0, ok: true };
  } catch (e: any) {
    try { db().exec('ROLLBACK'); } catch {}
    return {
      date: snapshotDate, totalRows: 0, changesCount: 0,
      durationMs: Date.now() - t0, ok: false, error: e?.message ?? String(e),
    };
  } finally {
    _running = false;
  }
}

function computeChanges(snapshotDate: string): number {
  const conn = db();
  // find previous snapshot date (most recent date < today)
  const prevRow = conn.prepare(`
    SELECT DISTINCT snapshot_date FROM rent_daily
    WHERE snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1
  `).get(snapshotDate) as { snapshot_date?: string } | undefined;
  const prevDay = prevRow?.snapshot_date;
  if (!prevDay) return 0;

  conn.prepare('DELETE FROM rent_changes WHERE snapshot_date = ?').run(snapshotDate);

  type Row = {
    month_num: number; floor: string; room: string;
    legal: string; status: string; rate: number | null;
  };
  const prevRows = conn.prepare(`
    SELECT month_num, floor, room, legal, status, rate FROM rent_daily WHERE snapshot_date = ?
  `).all(prevDay) as Row[];
  const currRows = conn.prepare(`
    SELECT month_num, floor, room, legal, status, rate FROM rent_daily WHERE snapshot_date = ?
  `).all(snapshotDate) as Row[];

  const key = (r: Row) => `${r.month_num}|${(r.room ?? '').trim().toLowerCase()}`;
  const P = new Map<string, Row>();
  for (const r of prevRows) { if (r.room) P.set(key(r), r); }
  const N = new Map<string, Row>();
  for (const r of currRows) { if (r.room) N.set(key(r), r); }

  const detectedAt = localIsoDateTime();
  const insChange = conn.prepare(`
    INSERT INTO rent_changes
      (detected_at, snapshot_date, month_num, kind, floor, room,
       prev_legal, next_legal, prev_rate, next_rate, prev_status, next_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;

  for (const [k, n] of N) {
    const p = P.get(k);
    if (!p) {
      if (n.legal && n.status === 'сдан') {
        insChange.run(detectedAt, snapshotDate, n.month_num, 'added', n.floor, n.room,
          null, n.legal, null, n.rate, null, n.status);
        count++;
      }
      continue;
    }
    if ((p.legal || '') !== (n.legal || '') && n.legal && p.legal) {
      insChange.run(detectedAt, snapshotDate, n.month_num, 'legal_changed', n.floor, n.room,
        p.legal, n.legal, p.rate, n.rate, p.status, n.status);
      count++;
    }
    if (p.status !== n.status) {
      insChange.run(detectedAt, snapshotDate, n.month_num, 'status_changed', n.floor, n.room,
        p.legal, n.legal, p.rate, n.rate, p.status, n.status);
      count++;
    }
    if ((p.rate ?? null) !== (n.rate ?? null) && p.rate != null && n.rate != null) {
      insChange.run(detectedAt, snapshotDate, n.month_num, 'rate_changed', n.floor, n.room,
        p.legal, n.legal, p.rate, n.rate, p.status, n.status);
      count++;
    }
  }
  for (const [k, p] of P) {
    if (!N.has(k) && p.legal && p.status === 'сдан') {
      insChange.run(detectedAt, snapshotDate, p.month_num, 'removed', p.floor, p.room,
        p.legal, null, p.rate, null, p.status, null);
      count++;
    }
  }
  return count;
}

/**
 * Bootstraps a snapshot if no DB row exists yet; otherwise returns immediately.
 * All read APIs call this before querying.
 */
export async function ensureSnapshot(): Promise<string | null> {
  const latest = latestSnapshotDate();
  if (latest) return latest;
  const r = await takeSnapshot();
  return r.ok ? r.date : null;
}
