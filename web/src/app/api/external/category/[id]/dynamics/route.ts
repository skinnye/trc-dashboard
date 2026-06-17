import { NextRequest, NextResponse } from 'next/server';
import { getNewcomers, getDropouts, getCategoryTrend } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const scope = req.nextUrl.searchParams.get('scope') || 'district';
  return NextResponse.json({
    newcomers: getNewcomers(n, scope, 200),
    dropouts: getDropouts(n, scope, 200),
    trend: getCategoryTrend(n),
  });
}
