import { NextResponse } from 'next/server';
import { getYearStats } from '@/lib/movements';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ years: getYearStats() });
}
