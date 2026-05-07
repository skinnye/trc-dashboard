import { NextResponse } from 'next/server';
import { getLive } from '@/lib/traffic';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const d = await cached('live:perimeter', 60_000, () => getLive());
    return NextResponse.json(d);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
