import { NextRequest, NextResponse } from 'next/server';
import { getHourlyAvg } from '@/lib/traffic';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

function parseDate(v: string | null, def: Date): Date {
  if (!v) return def;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : def;
}

export async function GET(req: NextRequest) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const start = parseDate(req.nextUrl.searchParams.get('start'), weekAgo);
  const endRaw = parseDate(req.nextUrl.searchParams.get('end'), today);
  const end = new Date(endRaw);
  end.setDate(end.getDate() + 1);

  const includesToday = endRaw.getTime() >= today.getTime();
  const ttl = includesToday ? 5 * 60_000 : 60 * 60_000;
  const key = `hourly:${start.toISOString().slice(0, 10)}:${endRaw.toISOString().slice(0, 10)}`;

  try {
    const zones = await cached(key, ttl, () => getHourlyAvg(start, end));
    return NextResponse.json({
      period: {
        start: start.toISOString().slice(0, 10),
        end:   endRaw.toISOString().slice(0, 10),
      },
      zones,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
