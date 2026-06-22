import { NextRequest, NextResponse } from 'next/server';
import { getZones, getStoreList, getMetricByStore, getPeriodBounds, latestYear } from '@/lib/map';

export const dynamic = 'force-dynamic';

// 'YYYY-MM' → year*100+month. Невалидное → null.
function toYM(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

// Всё для страницы карты этажа за выбранный период: зоны, магазины (для
// назначения), границы данных и значения всех метрик по магазину.
export async function GET(req: NextRequest) {
  const floor = Number(req.nextUrl.searchParams.get('floor'));
  if (!Number.isFinite(floor)) return NextResponse.json({ error: 'bad floor' }, { status: 400 });

  const bounds = getPeriodBounds();
  // период по умолчанию — весь последний год (YTD)
  const y = latestYear();
  const defFrom = y ? y * 100 + 1 : 0;
  const defTo = bounds ? Number(bounds.max.replace('-', '')) : 999912;

  const from = toYM(req.nextUrl.searchParams.get('from')) ?? defFrom;
  const to = toYM(req.nextUrl.searchParams.get('to')) ?? defTo;
  const lo = Math.min(from, to), hi = Math.max(from, to);

  return NextResponse.json({
    floor,
    viewBox: '0 0 29700 21000',
    bounds,                       // { min, max } как 'YYYY-MM'
    period: {
      from: `${Math.floor(lo / 100)}-${String(lo % 100).padStart(2, '0')}`,
      to: `${Math.floor(hi / 100)}-${String(hi % 100).padStart(2, '0')}`,
    },
    zones: getZones(floor),
    stores: getStoreList(),
    metrics: {
      to:        getMetricByStore('to', lo, hi),
      to_per_m2: getMetricByStore('to_per_m2', lo, hi),
      receipts:  getMetricByStore('receipts', lo, hi),
      avg_check: getMetricByStore('avg_check', lo, hi),
    },
  });
}
