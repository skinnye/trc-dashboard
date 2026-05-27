import { NextResponse } from 'next/server';
import { getYearlyTotals } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ years: getYearlyTotals() });
}
