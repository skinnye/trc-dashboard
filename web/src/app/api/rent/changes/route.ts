import { NextRequest, NextResponse } from 'next/server';
import { getPaymentLog } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get('since') ?? undefined;
  const rows = getPaymentLog(since || undefined);
  return NextResponse.json({ changes: rows, count: rows.length });
}
