import { NextRequest, NextResponse } from 'next/server';
import { ensureSnapshot } from '@/lib/snapshot';
import { getTenantsForMonth } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const m = Number(req.nextUrl.searchParams.get('month'));
  if (!m || m < 1 || m > 12) {
    return NextResponse.json({ error: 'month param required (1-12)' }, { status: 400 });
  }
  const date = await ensureSnapshot();
  if (!date) return NextResponse.json({ error: 'no snapshot' }, { status: 500 });

  const items = getTenantsForMonth(date, m);
  const totalPlan = items.reduce((s, r) => s + r.plan, 0);
  const totalFact = items.reduce((s, r) => s + r.fact, 0);
  const totalPct  = totalPlan > 0 ? Math.round((totalFact / totalPlan) * 1000) / 10 : 0;
  return NextResponse.json({ month: m, items, totalPlan, totalFact, totalPct });
}
