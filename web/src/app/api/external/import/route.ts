import { NextRequest, NextResponse } from 'next/server';
import { importExternalExcel } from '@/lib/external-import';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  const r = await importExternalExcel(force);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
