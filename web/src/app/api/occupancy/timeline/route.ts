import { NextResponse } from 'next/server';
import { getOccupancyTimeline, getOccupancyByYear } from '@/lib/occupancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    monthly: getOccupancyTimeline(),
    yearly:  getOccupancyByYear(),
  });
}
