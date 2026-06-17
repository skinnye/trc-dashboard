import { NextRequest, NextResponse } from 'next/server';
import { getZones, getStoreList, getMetricByStore, latestYear } from '@/lib/map';

export const dynamic = 'force-dynamic';

// Всё для страницы карты одного этажа: зоны, список магазинов (для назначения),
// и значения всех метрик по магазину (чтобы переключать метрику без перезапроса).
export async function GET(req: NextRequest) {
  const floor = Number(req.nextUrl.searchParams.get('floor'));
  if (!Number.isFinite(floor)) return NextResponse.json({ error: 'bad floor' }, { status: 400 });
  return NextResponse.json({
    floor,
    year: latestYear(),
    viewBox: '0 0 29700 21000',
    zones: getZones(floor),
    stores: getStoreList(),
    metrics: {
      to:        getMetricByStore('to'),
      to_per_m2: getMetricByStore('to_per_m2'),
      receipts:  getMetricByStore('receipts'),
      avg_check: getMetricByStore('avg_check'),
    },
  });
}
