import { NextResponse } from 'next/server';
import { ensureSnapshot } from '@/lib/snapshot';
import { getRatingLegacy } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Need rent_daily snapshot for plan_vat by (month, legal); fact comes from
  // tenant_payments (Python's fresh poller).
  const date = await ensureSnapshot();
  if (!date) return NextResponse.json({ error: 'no snapshot' }, { status: 500 });
  return NextResponse.json(getRatingLegacy(date));
}
