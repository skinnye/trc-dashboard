import { NextResponse } from 'next/server';
import { getRoomTimeline } from '@/lib/occupancy';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ room: string }> }) {
  const { room } = await ctx.params;
  const decoded = decodeURIComponent(room);
  return NextResponse.json({
    room: decoded,
    timeline: getRoomTimeline(decoded),
  });
}
