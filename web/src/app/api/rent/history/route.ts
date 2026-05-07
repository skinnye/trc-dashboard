import { NextRequest, NextResponse } from 'next/server';
import { ensureSnapshot } from '@/lib/snapshot';
import { getPaymentHistoryForMonthLegacy } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const m = Number(req.nextUrl.searchParams.get('month'));
  if (!m || m < 1 || m > 12) {
    return NextResponse.json({ error: 'month param required (1-12)' }, { status: 400 });
  }
  const date = await ensureSnapshot();
  if (!date) return NextResponse.json({ error: 'no snapshot' }, { status: 500 });

  const items = getPaymentHistoryForMonthLegacy(date, m);
  const totalPlan = items.reduce((s, r) => s + r.planVat, 0);
  const totalFact = items.reduce((s, r) => s + r.factOplat, 0);
  const totalPct  = totalPlan > 0 ? Math.round((totalFact / totalPlan) * 1000) / 10 : 0;
  // sort: paid-in-full first, then by descending debt
  items.sort((a, b) => {
    const aFull = a.pct >= 100 ? 0 : 1;
    const bFull = b.pct >= 100 ? 0 : 1;
    if (aFull !== bFull) return aFull - bFull;
    return (b.planVat - b.factOplat) - (a.planVat - a.factOplat);
  });
  return NextResponse.json({ month: m, items, totalPlan, totalFact, totalPct });
}
