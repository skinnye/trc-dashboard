import { NextResponse } from 'next/server';
import { getExternalSummary, getCategoriesOverview, getDynamicsSummary } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    summary: getExternalSummary(),
    categories: getCategoriesOverview(),
    dynamics: getDynamicsSummary(),
  });
}
