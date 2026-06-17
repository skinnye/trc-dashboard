import { NextResponse } from 'next/server';
import { getTenantPeriodYoY } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isFinite(y)) return NextResponse.json({ error: 'bad year' }, { status: 400 });
  // tenants теперь с корректным сравнением период-в-период (см. turnover.ts).
  return NextResponse.json({
    year: y,
    tenants: getTenantPeriodYoY(y),
  });
}
