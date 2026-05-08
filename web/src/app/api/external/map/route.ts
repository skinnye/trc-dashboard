import { NextRequest, NextResponse } from 'next/server';
import { getMapPoints } from '@/lib/external';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cat = req.nextUrl.searchParams.get('category');
  const categoryId = cat ? Number(cat) : undefined;
  const points = getMapPoints(Number.isFinite(categoryId) ? categoryId : undefined);
  return NextResponse.json({ points });
}
