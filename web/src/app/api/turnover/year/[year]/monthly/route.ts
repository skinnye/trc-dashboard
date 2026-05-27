import { NextRequest, NextResponse } from 'next/server';
import { getYearMonthlyTotals, getYearStoreMonthlyMatrix } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ year: string }> }) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isFinite(y)) return NextResponse.json({ error: 'bad year' }, { status: 400 });
  const metric = req.nextUrl.searchParams.get('metric') === 'to_per_m2' ? 'to_per_m2' : 'to_sum';
  return NextResponse.json({
    year: y,
    totals: getYearMonthlyTotals(y),
    matrix: getYearStoreMonthlyMatrix(y, metric),
  });
}
