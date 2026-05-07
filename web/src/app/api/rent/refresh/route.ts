import { NextResponse } from 'next/server';
import { takeSnapshot } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

export async function POST() {
  const r = await takeSnapshot();
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'snapshot failed' }, { status: 500 });
  return NextResponse.json(r);
}
