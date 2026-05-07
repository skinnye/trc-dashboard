import { NextResponse } from 'next/server';
import { getMonthlyTotalsLegacy, getLegacyCaptureMeta } from '@/lib/queries';
import { MONTH_NAMES_RU } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const meta = getLegacyCaptureMeta();
  if (!meta) return NextResponse.json({ error: 'Нет данных в monthly_totals' }, { status: 500 });

  const totals = getMonthlyTotalsLegacy();
  const map = new Map(totals.map(t => [t.month, t]));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const row = map.get(m);
    months.push({
      month: m,
      monthName: MONTH_NAMES_RU[m],
      hasFact: !!row && (row.factSTo != null || row.factBezTo != null),
      planSTo:   row?.planSTo   ?? null,
      planBezTo: row?.planBezTo ?? null,
      factSTo:   row?.factSTo   ?? null,
      factBezTo: row?.factBezTo ?? null,
    });
  }
  return NextResponse.json({
    updatedAt: meta.capturedAt,
    snapshotDate: meta.capturedAt.slice(0, 10),
    months,
  });
}
