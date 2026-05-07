import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/mssql';
import { PERIMETER_ZONE } from '@/lib/traffic';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = await getPool();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  // Hourly ins/outs for past 7 days at perimeter from BOTH tables
  const r1 = await pool.request()
    .input('from', sql.DateTime, weekAgo)
    .input('to',   sql.DateTime, tomorrow)
    .query(`
      SELECT CAST(s.TimeRecord AS DATE) AS d,
             DATEPART(HOUR, s.TimeRecord) AS h,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn  ELSE 0 END) AS ins,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumOut ELSE 0 END) AS outs
      FROM CM_StorageEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE cze.ID_Zone = ${PERIMETER_ZONE}
        AND s.TimeRecord >= @from AND s.TimeRecord < @to
      GROUP BY CAST(s.TimeRecord AS DATE), DATEPART(HOUR, s.TimeRecord)
      ORDER BY d, h
    `);
  // Per-day totals
  const r2 = await pool.request()
    .input('from', sql.DateTime, weekAgo)
    .input('to',   sql.DateTime, tomorrow)
    .query(`
      SELECT CAST(s.TimeRecord AS DATE) AS d,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn  ELSE 0 END) AS ins,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumOut ELSE 0 END) AS outs
      FROM CM_StorageEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE cze.ID_Zone = ${PERIMETER_ZONE}
        AND s.TimeRecord >= @from AND s.TimeRecord < @to
      GROUP BY CAST(s.TimeRecord AS DATE)
      ORDER BY d
    `);
  // Same on StatusEnter
  const r3 = await pool.request()
    .input('from', sql.DateTime, weekAgo)
    .input('to',   sql.DateTime, tomorrow)
    .query(`
      SELECT CAST(s.TimeRecord AS DATE) AS d,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumIn  ELSE 0 END) AS ins_status,
             SUM(CASE WHEN cze.ID_Vector=1 THEN s.SumOut ELSE 0 END) AS outs_status
      FROM CM_StorageStatusEnter s
      JOIN CM_CrossZoneEnter cze ON s.ID_Enter = cze.ID_Enter
      WHERE s.Status IN (1,2)
        AND cze.ID_Zone = ${PERIMETER_ZONE}
        AND s.TimeRecord >= @from AND s.TimeRecord < @to
      GROUP BY CAST(s.TimeRecord AS DATE)
      ORDER BY d
    `);
  return NextResponse.json({
    hourly: r1.recordset,
    dailyStorageEnter: r2.recordset,
    dailyStorageStatusEnter: r3.recordset,
  });
}
