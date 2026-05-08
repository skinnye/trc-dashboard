/**
 * Чтение помесячной истории статусов помещений (Сдан / Не сдан) из
 * rent_status_history. Источник — годовые Excel-файлы план-факт за все
 * годы, импортируется Python-скриптом parser/import_status_history.py.
 */
import { db } from './db';

export interface MonthlyOccupancy {
  year: number;
  month: number;
  rented: number;
  vacant: number;
  total: number;
  pct: number;                 // rented / (rented + vacant) × 100
  rentedAreaM2: number;
  vacantAreaM2: number;
  pctArea: number;             // та же занятость, но взвешенная по площади
}

export function getOccupancyTimeline(): MonthlyOccupancy[] {
  return db()
    .prepare(`
      SELECT year, month,
             SUM(CASE WHEN status='rented' THEN 1 ELSE 0 END)     AS rented,
             SUM(CASE WHEN status='not_rented' THEN 1 ELSE 0 END) AS vacant,
             SUM(CASE WHEN status='rented'     THEN COALESCE(area_m2, 0) ELSE 0 END) AS rentedAreaM2,
             SUM(CASE WHEN status='not_rented' THEN COALESCE(area_m2, 0) ELSE 0 END) AS vacantAreaM2
      FROM rent_status_history
      GROUP BY year, month ORDER BY year, month
    `)
    .all()
    .map(r => {
      const row = r as { year: number; month: number; rented: number; vacant: number;
                         rentedAreaM2: number; vacantAreaM2: number };
      const total = row.rented + row.vacant;
      const totalArea = row.rentedAreaM2 + row.vacantAreaM2;
      return {
        ...row,
        total,
        pct: total ? (row.rented * 100) / total : 0,
        pctArea: totalArea ? (row.rentedAreaM2 * 100) / totalArea : 0,
      };
    });
}

// Сводка по годам — средняя заполняемость + общая площадь.
export interface YearOccupancy {
  year: number;
  months: number;              // сколько месяцев данных
  avgPct: number;              // средний % сдан по месяцам
  avgPctArea: number;
  avgRentedArea: number;       // среднемесячно сдано м²
  avgVacantArea: number;
}

export function getOccupancyByYear(): YearOccupancy[] {
  const rows = getOccupancyTimeline();
  const byYear = new Map<number, MonthlyOccupancy[]>();
  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  return Array.from(byYear.entries())
    .map(([year, ms]) => {
      const n = ms.length;
      const sum = (k: keyof MonthlyOccupancy) => ms.reduce((s, m) => s + (m[k] as number), 0);
      return {
        year,
        months: n,
        avgPct:        sum('pct') / n,
        avgPctArea:    sum('pctArea') / n,
        avgRentedArea: sum('rentedAreaM2') / n,
        avgVacantArea: sum('vacantAreaM2') / n,
      };
    })
    .sort((a, b) => a.year - b.year);
}

// Тайм-лайн одной комнаты — какой статус был в каждом месяце.
export interface RoomMonthRow {
  year: number;
  month: number;
  status: 'rented' | 'not_rented' | 'other';
  statusRaw: string | null;
  legalName: string | null;
  tradeName: string | null;
  areaM2: number | null;
}

export function getRoomTimeline(room: string): RoomMonthRow[] {
  return db()
    .prepare(`
      SELECT year, month, status, status_raw AS statusRaw,
             legal_name AS legalName, trade_name AS tradeName,
             area_m2 AS areaM2
      FROM rent_status_history
      WHERE LOWER(room) = LOWER(?)
      ORDER BY year, month
    `)
    .all(room) as unknown as RoomMonthRow[];
}

// Топ-долго-пустых комнат: сколько месяцев из имеющейся истории помещение
// числилось «не сдан». Даёт понимание, какие точки трудно сдавать.
export interface VacantRoomRow {
  room: string;
  floor: string | null;
  vacantMonths: number;
  rentedMonths: number;
  totalMonths: number;
  pctVacant: number;
  lastVacantPeriod: string | null;
  avgArea: number | null;
}

export function getTopVacantRooms(limit = 50): VacantRoomRow[] {
  return db()
    .prepare(`
      SELECT room,
             (SELECT floor FROM rent_status_history WHERE room = h.room
                AND floor IS NOT NULL ORDER BY year DESC, month DESC LIMIT 1) AS floor,
             SUM(CASE WHEN status='not_rented' THEN 1 ELSE 0 END) AS vacantMonths,
             SUM(CASE WHEN status='rented'     THEN 1 ELSE 0 END) AS rentedMonths,
             COUNT(*) AS totalMonths,
             MAX(CASE WHEN status='not_rented'
                      THEN printf('%04d-%02d', year, month) END)  AS lastVacantPeriod,
             AVG(area_m2) AS avgArea
      FROM rent_status_history h
      WHERE room IS NOT NULL
      GROUP BY room
      HAVING vacantMonths > 0
      ORDER BY vacantMonths DESC, totalMonths DESC
      LIMIT ?
    `)
    .all(limit)
    .map(r => {
      const row = r as { room: string; floor: string | null; vacantMonths: number;
                         rentedMonths: number; totalMonths: number;
                         lastVacantPeriod: string | null; avgArea: number | null };
      return {
        ...row,
        pctVacant: row.totalMonths ? (row.vacantMonths * 100) / row.totalMonths : 0,
      };
    });
}
