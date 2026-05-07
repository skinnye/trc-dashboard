import { NextRequest, NextResponse } from 'next/server';
import { setTenantComment } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const trade = typeof body?.trade === 'string' ? body.trade.trim() : '';
  const comment = typeof body?.comment === 'string' ? body.comment : '';
  if (!trade) {
    return NextResponse.json({ error: 'trade required' }, { status: 400 });
  }

  setTenantComment(trade, comment);
  return NextResponse.json({ ok: true });
}
