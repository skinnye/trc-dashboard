import { NextRequest, NextResponse } from 'next/server';
import {
  getRange, FLOOR1_ZONE, FLOOR2_ZONE, FLOOR4_ZONE, FLOOR3_VIRTUAL, PERIMETER_ZONE,
} from '@/lib/traffic';

export const dynamic = 'force-dynamic';

const FLOOR_ZONE: Record<number, number> = {
  1: FLOOR1_ZONE, 2: FLOOR2_ZONE, 3: FLOOR3_VIRTUAL, 4: FLOOR4_ZONE,
};

// 'YYYY-MM' → начало месяца / начало следующего (для диапазона дат).
function ymStart(s: string): Date { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1); }
function ymEnd(s: string): Date { const [y, m] = s.split('-').map(Number); return new Date(y, m, 1); }

// Трафик этажа за период из MSSQL (счётчики между этажами). Если БД счётчиков
// недоступна с прод-сервера — отдаём ok:false, фронт деградирует мягко.
export async function GET(req: NextRequest) {
  const floor = Number(req.nextUrl.searchParams.get('floor'));
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const zoneId = FLOOR_ZONE[floor];
  if (!zoneId || !from || !to) {
    return NextResponse.json({ ok: false, error: 'нужны floor(1-4), from, to' }, { status: 200 });
  }
  try {
    const start = ymStart(from);
    const end = ymEnd(to);
    const { totals } = await getRange(start, end);
    const floorTraffic = totals.find(t => t.id === zoneId)?.total ?? 0;
    const perimeterTraffic = totals.find(t => t.id === PERIMETER_ZONE)?.total ?? 0;
    return NextResponse.json({ ok: true, floor, floorTraffic, perimeterTraffic });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? String(e) }, { status: 200 });
  }
}
