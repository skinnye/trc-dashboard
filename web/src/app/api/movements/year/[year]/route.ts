import { NextResponse } from 'next/server';
import { getMonthlyByYear, getMovements } from '@/lib/movements';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isFinite(y)) return NextResponse.json({ error: 'bad year' }, { status: 400 });
  return NextResponse.json({
    year: y,
    monthly: getMonthlyByYear(y),
    movements: getMovements(y, undefined, 5000),
  });
}
