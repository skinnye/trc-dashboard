import { NextResponse } from 'next/server';
import { getOrg } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const data = getOrg(n);
  if (!data.org) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data);
}
