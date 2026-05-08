import { NextResponse } from 'next/server';
import { getNewcomers, getDropouts, getCategoryTrend } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  return NextResponse.json({
    newcomers: getNewcomers(n, 200),
    dropouts: getDropouts(n, 200),
    trend: getCategoryTrend(n),
  });
}
