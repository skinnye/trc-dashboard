/**
 * Чтение реестра съездов/заездов арендаторов из tenant_movements.
 * Источник — годовые Excel-файлы план-факт из шары Бюджета,
 * импортируется Python-скриптом parser/import_movements.py.
 */
import { db } from './db';

export type MovementKind = 'departure' | 'arrival';

export interface YearStats {
  year: number;
  arrivals: number;
  departures: number;
  netCount: number;
  arrivalsAreaM2: number;
  departuresAreaM2: number;
  netAreaM2: number;
  arrivalsCharges: number;     // ₽/мес, с НДС
  departuresCharges: number;
  netCharges: number;          // приход-уход, может быть отрицательным
}

export function getYearStats(): YearStats[] {
  return db()
    .prepare(`
      SELECT
        year,
        SUM(CASE WHEN kind = 'arrival'   THEN 1 ELSE 0 END) AS arrivals,
        SUM(CASE WHEN kind = 'departure' THEN 1 ELSE 0 END) AS departures,
        SUM(CASE WHEN kind = 'arrival'   THEN COALESCE(area_m2, 0) ELSE 0 END) AS arrivalsAreaM2,
        SUM(CASE WHEN kind = 'departure' THEN COALESCE(area_m2, 0) ELSE 0 END) AS departuresAreaM2,
        SUM(CASE WHEN kind = 'arrival'   THEN COALESCE(charges_with_vat, 0) ELSE 0 END) AS arrivalsCharges,
        SUM(CASE WHEN kind = 'departure' THEN COALESCE(charges_with_vat, 0) ELSE 0 END) AS departuresCharges
      FROM tenant_movements
      GROUP BY year ORDER BY year
    `)
    .all()
    .map(r => {
      const row = r as {
        year: number; arrivals: number; departures: number;
        arrivalsAreaM2: number; departuresAreaM2: number;
        arrivalsCharges: number; departuresCharges: number;
      };
      return {
        ...row,
        netCount:   row.arrivals - row.departures,
        netAreaM2:  row.arrivalsAreaM2 - row.departuresAreaM2,
        netCharges: row.arrivalsCharges - row.departuresCharges,
      };
    });
}

export interface MonthlyPoint {
  year: number;
  month: number;       // 1..12
  arrivals: number;
  departures: number;
}

export function getMonthlyByYear(year: number): MonthlyPoint[] {
  // event_date бывает NULL — учитываем только записи, у которых дата распарсилась.
  // Группируем по STRFTIME('%m', event_date), затем заполняем «дыры» в JS.
  const rows = db()
    .prepare(`
      SELECT
        CAST(strftime('%m', event_date) AS INTEGER) AS month,
        SUM(CASE WHEN kind = 'arrival'   THEN 1 ELSE 0 END) AS arrivals,
        SUM(CASE WHEN kind = 'departure' THEN 1 ELSE 0 END) AS departures
      FROM tenant_movements
      WHERE year = ? AND event_date IS NOT NULL
      GROUP BY month ORDER BY month
    `)
    .all(year) as { month: number; arrivals: number; departures: number }[];
  const map = new Map(rows.map(r => [r.month, r]));
  const out: MonthlyPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = map.get(m);
    out.push({
      year, month: m,
      arrivals: r?.arrivals ?? 0,
      departures: r?.departures ?? 0,
    });
  }
  return out;
}

export interface MovementRow {
  id: number;
  year: number;
  kind: MovementKind;
  seqNo: number | null;
  floor: string | null;
  room: string | null;
  areaM2: number | null;
  ratePerM2: number | null;
  legalName: string | null;
  tradeName: string | null;
  chargesNoVat: number | null;
  chargesWithVat: number | null;
  eventDate: string | null;
  dateRaw: string | null;
}

export function getMovements(year?: number, kind?: MovementKind, limit = 1000): MovementRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (year)  { where.push('year = ?');  args.push(year); }
  if (kind)  { where.push('kind = ?');  args.push(kind); }
  const sql = `
    SELECT
      id, year, kind, seq_no AS seqNo, floor, room,
      area_m2 AS areaM2, rate_per_m2 AS ratePerM2,
      legal_name AS legalName, trade_name AS tradeName,
      charges_no_vat AS chargesNoVat, charges_with_vat AS chargesWithVat,
      event_date AS eventDate, date_raw AS dateRaw
    FROM tenant_movements
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY year, COALESCE(event_date, '9999-12-31'), kind, seq_no
    LIMIT ?
  `;
  args.push(limit);
  return db().prepare(sql).all(...args) as unknown as MovementRow[];
}

// История одного помещения — кто и когда там был. Полезно при клике на
// номер помещения в таблице.
export function getRoomHistory(room: string): MovementRow[] {
  return db()
    .prepare(`
      SELECT
        id, year, kind, seq_no AS seqNo, floor, room,
        area_m2 AS areaM2, rate_per_m2 AS ratePerM2,
        legal_name AS legalName, trade_name AS tradeName,
        charges_no_vat AS chargesNoVat, charges_with_vat AS chargesWithVat,
        event_date AS eventDate, date_raw AS dateRaw
      FROM tenant_movements
      WHERE room = ?
      ORDER BY COALESCE(event_date, year || '-01-01')
    `)
    .all(room) as unknown as MovementRow[];
}
