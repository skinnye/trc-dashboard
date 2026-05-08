import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ runs: listRuns(50) });
}
