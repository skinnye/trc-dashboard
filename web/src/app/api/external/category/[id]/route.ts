import { NextRequest, NextResponse } from 'next/server';
import { getCategory } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const scope = req.nextUrl.searchParams.get('scope') || 'district';
  const data = getCategory(n, scope);
  if (!data.category) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data);
}
