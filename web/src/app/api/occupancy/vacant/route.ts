import { NextResponse } from 'next/server';
import { getTopVacantRooms } from '@/lib/occupancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ rooms: getTopVacantRooms(100) });
}
