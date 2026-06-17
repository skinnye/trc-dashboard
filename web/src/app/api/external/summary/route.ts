import { NextRequest, NextResponse } from 'next/server';
import { getExternalSummary, getCategoriesOverview, getDynamicsSummary, listScopes } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') || 'district';
  return NextResponse.json({
    scope,
    scopes: listScopes(),
    summary: getExternalSummary(scope),
    categories: getCategoriesOverview(scope),
    dynamics: getDynamicsSummary(scope),
  });
}
