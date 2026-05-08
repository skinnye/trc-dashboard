import { NextRequest, NextResponse } from 'next/server';
import { listSettings, setSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ settings: listSettings() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key = body?.key as string | undefined;
  const value = body?.value as string | null | undefined;
  const description = body?.description as string | undefined;
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  setSetting(key, value ?? null, description);
  return NextResponse.json({ ok: true });
}
