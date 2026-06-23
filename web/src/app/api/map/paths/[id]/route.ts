import { NextResponse } from 'next/server';
import { deletePath } from '@/lib/map';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  deletePath(n);
  return NextResponse.json({ ok: true });
}
