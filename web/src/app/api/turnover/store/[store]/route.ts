import { NextResponse } from 'next/server';
import { getStoreTimeline } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ store: string }> }) {
  const { store } = await ctx.params;
  const decoded = decodeURIComponent(store);
  return NextResponse.json({
    store: decoded,
    timeline: getStoreTimeline(decoded),
  });
}
