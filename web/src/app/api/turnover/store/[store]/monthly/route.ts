import { NextResponse } from 'next/server';
import { getStoreMonthlyTimeline, getStoreTimeline } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ store: string }> }) {
  const { store } = await ctx.params;
  // Next.js уже декодирует params — повторный decodeURIComponent падает
  // на любом имени с '%' (см. code review). Используем напрямую.
  return NextResponse.json({
    store,
    yearly:  getStoreTimeline(store),
    monthly: getStoreMonthlyTimeline(store),
  });
}
