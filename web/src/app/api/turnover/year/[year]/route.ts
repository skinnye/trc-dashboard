import { NextResponse } from 'next/server';
import { getTenantsForYear, getCategoryStats } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isFinite(y)) return NextResponse.json({ error: 'bad year' }, { status: 400 });
  return NextResponse.json({
    year: y,
    tenants:    getTenantsForYear(y),
    categories: getCategoryStats(y),
  });
}
