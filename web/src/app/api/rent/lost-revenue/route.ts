import { NextRequest, NextResponse } from 'next/server';
import { ensureSnapshot } from '@/lib/snapshot';
import {
  getLostRevenueForMonth, getLostRevenueByMonth, getLostRevenueByRoomYear,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const m = Number(req.nextUrl.searchParams.get('month'));
  const date = await ensureSnapshot();
  if (!date) return NextResponse.json({ error: 'no snapshot' }, { status: 500 });

  if (m && m >= 1 && m <= 12) {
    const items = getLostRevenueForMonth(date, m);
    const total = items.reduce((s, i) => s + i.potentialRevenue, 0);
    return NextResponse.json({ month: m, total, items });
  }
  const byMonth = getLostRevenueByMonth(date);
  const byRoom = getLostRevenueByRoomYear(date);
  const grand = Object.values(byMonth).reduce((s, v) => s + v, 0);
  return NextResponse.json({ totalYear: grand, byMonth, byRoom });
}
