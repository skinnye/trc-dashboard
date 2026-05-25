import { NextRequest, NextResponse } from 'next/server';
import { getRange } from '@/lib/traffic';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

function parseDate(v: string | null, def: Date): Date {
  if (!v) return def;
  // 'YYYY-MM-DD' через new Date() парсится как UTC-полночь. На сервере с
  // не-UTC TZ (например Екатеринбург UTC+5) это даёт сдвиг на +5 часов —
  // MSSQL отрезает первые часы первого дня диапазона, и день показывает 0.
  // Парсим явно как локальную полночь — совпадает с остальными датами,
  // которые тоже считаются от локального dni.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : def;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const start = parseDate(req.nextUrl.searchParams.get('start'), monthAgo);
  const endRaw = parseDate(req.nextUrl.searchParams.get('end'), today);
  const end = new Date(endRaw);
  end.setDate(end.getDate() + 1);

  const compareMode = (req.nextUrl.searchParams.get('compare') ?? 'none') as 'none' | 'prev' | 'year';

  const includesToday = endRaw.getTime() >= today.getTime();
  const ttl = includesToday ? 5 * 60_000 : 60 * 60_000;

  try {
    const primary = await cached(
      `range:${iso(start)}:${iso(endRaw)}`,
      ttl,
      () => getRange(start, end),
    );

    let compare: {
      period: { start: string; end: string; mode: string };
      zones: typeof primary.totals;
      dates: string[];
      daily: Record<number, number[]>;
    } | null = null;

    if (compareMode === 'prev' || compareMode === 'year') {
      let cmpStart: Date, cmpEnd: Date;
      if (compareMode === 'prev') {
        const spanMs = end.getTime() - start.getTime();
        cmpEnd = new Date(start);
        cmpStart = new Date(start.getTime() - spanMs);
      } else {
        cmpStart = new Date(start); cmpStart.setFullYear(cmpStart.getFullYear() - 1);
        cmpEnd   = new Date(end);   cmpEnd.setFullYear(cmpEnd.getFullYear() - 1);
      }
      const cmpEndRaw = new Date(cmpEnd);
      cmpEndRaw.setDate(cmpEndRaw.getDate() - 1);
      const cmp = await cached(
        `range:${iso(cmpStart)}:${iso(cmpEndRaw)}`,
        24 * 3600_000,
        () => getRange(cmpStart, cmpEnd),
      );
      compare = {
        period: { start: iso(cmpStart), end: iso(cmpEndRaw), mode: compareMode },
        zones: cmp.totals,
        dates: cmp.dates,
        daily: cmp.daily,
      };
    }

    return NextResponse.json({
      period: { start: iso(start), end: iso(endRaw) },
      zones: primary.totals,
      dates: primary.dates,
      daily: primary.daily,
      compare,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
