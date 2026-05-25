import { NextRequest, NextResponse } from 'next/server';
import { listCameras, saveCameras, type Camera } from '@/lib/cameras';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ cameras: listCameras() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.cameras)) {
    return NextResponse.json({ error: 'expected { cameras: [{name, url}, ...] }' }, { status: 400 });
  }
  const cleaned: Camera[] = body.cameras
    .filter((c: unknown): c is Camera => typeof c === 'object' && c !== null && typeof (c as Camera).url === 'string')
    .map((c: Camera) => ({ name: String(c.name ?? '').trim() || 'Камера', url: c.url.trim() }));
  saveCameras(cleaned);
  return NextResponse.json({ ok: true, cameras: cleaned });
}
