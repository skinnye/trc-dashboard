import { NextRequest, NextResponse } from 'next/server';
import { savePath, getPaths } from '@/lib/map';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const floor = Number(req.nextUrl.searchParams.get('floor'));
  if (!Number.isFinite(floor)) return NextResponse.json({ error: 'bad floor' }, { status: 400 });
  return NextResponse.json({ paths: getPaths(floor) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.floor !== 'number' || !Array.isArray(body.points)) {
    return NextResponse.json({ error: 'нужны floor, points[]' }, { status: 400 });
  }
  const pts = body.points.filter((p: unknown) => Array.isArray(p) && p.length === 2);
  if (pts.length < 2) return NextResponse.json({ error: 'путь: минимум 2 точки (А и Б)' }, { status: 400 });
  const id = savePath(body.floor, pts);
  return NextResponse.json({ ok: true, id });
}
