import { NextRequest, NextResponse } from 'next/server';
import { getYearMonthHeat, getCategoryMonthHeat } from '@/lib/turnover';

export const dynamic = 'force-dynamic';

// Сезонная тепловая карта в трёх режимах. Режим «по магазинам» отдаётся
// существующим /year/[year]/monthly (matrix), здесь — годы и категории.
//   ?mode=year                 — годы × месяцы по всему ТРЦ
//   ?mode=category&year=2026    — категории × месяцы за год
//   &metric=to_sum|to_per_m2
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') ?? 'year';
  const metric = req.nextUrl.searchParams.get('metric') === 'to_per_m2' ? 'to_per_m2' : 'to_sum';

  if (mode === 'category') {
    const y = Number(req.nextUrl.searchParams.get('year'));
    if (!Number.isFinite(y)) return NextResponse.json({ error: 'bad year' }, { status: 400 });
    return NextResponse.json({ mode, metric, rows: getCategoryMonthHeat(y, metric) });
  }
  return NextResponse.json({ mode: 'year', metric, rows: getYearMonthHeat(metric) });
}
