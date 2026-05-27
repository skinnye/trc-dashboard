import { NextResponse } from 'next/server';
import { getStoreTimeline } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ store: string }> }) {
  const { store } = await ctx.params;
  // Next.js уже декодирует params. Повторный decodeURIComponent падает
  // с URIError на legit-именах с '%' (например «скидка 50%»).
  return NextResponse.json({
    store,
    timeline: getStoreTimeline(store),
  });
}
