import { NextRequest, NextResponse } from 'next/server';
import { getMonthly } from '@/lib/traffic';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear();
  const currentYear = new Date().getFullYear();
  try {
    // Previous year is frozen — long cache. Current year — 15 min.
    const [cur, prev] = await Promise.all([
      cached(`monthly:${year}`,     year === currentYear ? 15 * 60_000 : 24 * 3600_000, () => getMonthly(year)),
      cached(`monthly:${year - 1}`, year - 1 === currentYear ? 15 * 60_000 : 24 * 3600_000, () => getMonthly(year - 1)),
    ]);
    return NextResponse.json({ year, current: cur, previous: prev });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
