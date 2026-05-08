import { NextResponse } from 'next/server';
import { getRoomHistory } from '@/lib/movements';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ room: string }> }) {
  const { room } = await ctx.params;
  const decoded = decodeURIComponent(room);
  return NextResponse.json({
    room: decoded,
    history: getRoomHistory(decoded),
  });
}
