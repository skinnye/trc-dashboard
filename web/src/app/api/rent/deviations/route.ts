import { NextRequest, NextResponse } from 'next/server';
import { ensureSnapshot } from '@/lib/snapshot';
import { getRoomsForMonth } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const m = Number(req.nextUrl.searchParams.get('month'));
  if (!m || m < 1 || m > 12) {
    return NextResponse.json({ error: 'month param required (1-12)' }, { status: 400 });
  }
  const date = await ensureSnapshot();
  if (!date) return NextResponse.json({ error: 'no snapshot' }, { status: 500 });
  const rows = getRoomsForMonth(date, m).filter(r => r.status === 'сдан' && (r.planVat ?? 0) > 0);

  const above: any[] = [], below: any[] = [];
  for (const t of rows) {
    const plan = t.planVat ?? 0;
    const fact = t.factOplat ?? 0;
    const pct = plan ? Math.round((fact / plan) * 1000) / 10 : 0;
    const entry = {
      name:  t.legal || t.trade || t.room,
      trade: t.trade,
      room:  t.room,
      floor: t.floor,
      plan:  Math.round(plan),
      fact:  Math.round(fact),
      pct,
      delta: Math.round(fact - plan),
    };
    if (pct >= 100) above.push(entry); else below.push(entry);
  }
  above.sort((a, b) => b.pct - a.pct);
  below.sort((a, b) => a.pct - b.pct);
  return NextResponse.json({ above, below });
}
