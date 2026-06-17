import { NextRequest, NextResponse } from 'next/server';
import { saveZone, getZones } from '@/lib/map';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const floor = Number(req.nextUrl.searchParams.get('floor'));
  if (!Number.isFinite(floor)) return NextResponse.json({ error: 'bad floor' }, { status: 400 });
  return NextResponse.json({ zones: getZones(floor) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.floor !== 'number' || !body.storeName || !Array.isArray(body.points)) {
    return NextResponse.json({ error: 'нужны floor, storeName, points[]' }, { status: 400 });
  }
  // points: [[x,y],...]; минимально 3 точки для полигона.
  const pts = body.points.filter((p: unknown) => Array.isArray(p) && p.length === 2);
  if (pts.length < 3) return NextResponse.json({ error: 'полигон: минимум 3 точки' }, { status: 400 });
  const id = saveZone(body.floor, String(body.storeName), pts, body.id ? Number(body.id) : undefined);
  return NextResponse.json({ ok: true, id });
}
