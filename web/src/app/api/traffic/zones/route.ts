import { NextResponse } from 'next/server';
import { ZONES } from '@/lib/traffic';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ zones: ZONES });
}
