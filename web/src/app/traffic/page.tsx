'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, fmtShort, fmtPct, MONTH_NAMES_SHORT, cn } from '@/lib/utils';

type Zone = { id: number; name: string; color: string; icon: string };
type ZoneTotal = { id: number; name: string; total: number };

type RangeResp = {
  period: { start: string; end: string };
  zones: ZoneTotal[];
  dates: string[];
  daily: Record<number, number[]>;
  compare: null | {
    period: { start: string; end: string; mode: string };
    zones: ZoneTotal[];
    dates: string[];
    daily: Record<number, number[]>;
  };
};

type CompareMode = 'none' | 'prev' | 'year';

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildPresets(): { key: string; label: string; start: string; end: string }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);

  const dow = (today.getDay() + 6) % 7; // 0=Mon
  const twkStart = new Date(today); twkStart.setDate(twkStart.getDate() - dow);
  const lwkStart = new Date(twkStart); lwkStart.setDate(lwkStart.getDate() - 7);
  const lwkEnd   = new Date(twkStart); lwkEnd.setDate(lwkEnd.getDate() - 1);

  const tmStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lmEnd   = new Date(today.getFullYear(), today.getMonth(), 0);

  const tyStart = new Date(today.getFullYear(), 0, 1);
  const lyStart = new Date(today.getFullYear() - 1, 0, 1);
  const lyEnd   = new Date(today.getFullYear() - 1, 11, 31);

  type P = { key: string; label: string; start: string; end: string };
  // Order matches Flask traffic.html:166-173 — "Этот месяц" is the default.
  const presets: P[] = [
    { key: 'today', label: 'Сегодня',         start: isoLocal(today),    end: isoLocal(today)  },
    { key: 'yest',  label: 'Вчера',           start: isoLocal(yest),     end: isoLocal(yest)   },
    { key: 'twk',   label: 'Эта неделя',      start: isoLocal(twkStart), end: isoLocal(today)  },
    { key: 'lwk',   label: 'Прошлая неделя',  start: isoLocal(lwkStart), end: isoLocal(lwkEnd) },
    { key: 'tm',    label: 'Этот месяц',      start: isoLocal(tmStart),  end: isoLocal(today)  },
    { key: 'lm',    label: 'Прошлый месяц',   start: isoLocal(lmStart),  end: isoLocal(lmEnd)  },
    { key: 'ty',    label: 'Этот год',        start: isoLocal(tyStart),  end: isoLocal(today)  },
    { key: 'ly',    label: 'Прошлый год',     start: isoLocal(lyStart),  end: isoLocal(lyEnd)  },
  ];
  return presets;
}

function fmtDay(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

// Default — match Flask: «Этот месяц» + «Годом назад».
function defaultMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start: isoLocal(start), end: isoLocal(today) };
}

export default function TrafficPage() {
  const initial = defaultMonthRange();
  const [zones, setZones] = useState<Zone[]>([]);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [compareMode, setCompareMode] = useState<CompareMode>('year');
  const [activeZoneId, setActiveZoneId] = useState<number | null>(null); // null = все зоны

  const [range, setRange] = useState<RangeResp | null>(null);
  const [hourly, setHourly] = useState<{ zones: Record<number, number[]> } | null>(null);
  const [monthly, setMonthly] = useState<{ current: Record<number, number[]>; previous: Record<number, number[]> } | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/traffic/zones').then(r => r.json()).then(d => setZones(d.zones));
  }, []);

  const loadPeriod = useCallback(async (s = start, e = end, cmp = compareMode) => {
    setLoading(true);
    try {
      const q = `start=${s}&end=${e}`;
      const [r1, r2] = await Promise.all([
        fetch(`/api/traffic/range?${q}&compare=${cmp}`).then(r => r.json()),
        fetch(`/api/traffic/hourly?${q}`).then(r => r.json()),
      ]);
      setRange(r1);
      setHourly(r2);
    } finally { setLoading(false); }
  }, [start, end, compareMode]);

  // Initial load.
  useEffect(() => { loadPeriod(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Reload when compareMode changes.
  useEffect(() => { loadPeriod(start, end, compareMode); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [compareMode]);

  useEffect(() => {
    fetch(`/api/traffic/monthly?year=${year}`).then(r => r.json()).then(setMonthly);
  }, [year]);

  const presets = useMemo(buildPresets, []);
  const applyPreset = (s: string, e: string) => {
    setStart(s); setEnd(e);
    loadPeriod(s, e, compareMode);
  };

  const perimId = zones.find(z => z.name === 'Периметр')?.id ?? 127479461;
  const focusZoneId = activeZoneId ?? perimId;
  const focusZone = zones.find(z => z.id === focusZoneId);

  // ── Daily chart config ────────────────────────────────────────────────
  const dailyConfig = useMemo(() => {
    if (!range || !focusZone) return null;
    const dataA = range.daily[focusZoneId] ?? [];
    const datasets: any[] = [{
      label: `${focusZone.name} · ${range.period.start} — ${range.period.end}`,
      data: dataA,
      borderColor: focusZone.color,
      backgroundColor: focusZone.color + '25',
      fill: true,
      tension: 0.3, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
    }];
    if (range.compare) {
      const dataB = range.compare.daily[focusZoneId] ?? [];
      const len = Math.min(dataA.length, dataB.length);
      datasets.push({
        label: `Сравнение · ${range.compare.period.start} — ${range.compare.period.end}`,
        data: dataB.slice(0, len),
        borderColor: '#9ca3af',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        tension: 0.3, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
      });
    }
    return {
      type: 'line' as const,
      data: { labels: range.dates.map(fmtDay), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index' as const, intersect: false },
        plugins: {
          legend: { position: 'top' as const, labels: { boxWidth: 12, padding: 16 } },
          tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v: any) => fmtShort(v) } } },
      },
    };
  }, [range, focusZone, focusZoneId]);

  // ── Day-cards (per-day totals + delta vs compare) ────────────────────
  const dayCards = useMemo(() => {
    if (!range) return [];
    const vs = range.compare?.daily[focusZoneId] ?? null;
    return range.dates.map((d, i) => {
      const v = range.daily[focusZoneId]?.[i] ?? 0;
      const cmp = vs ? vs[i] ?? 0 : null;
      const delta = cmp != null && cmp > 0 ? ((v - cmp) / cmp) * 100 : null;
      return { date: d, value: v, cmp, delta };
    });
  }, [range, focusZoneId]);

  // ── Hourly chart (honors zone pill filter) ────────────────────────────
  const hourlyConfig = useMemo(() => {
    if (!hourly || zones.length === 0) return null;
    const labels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
    const visible = activeZoneId == null
      ? zones.filter(z => z.name !== 'Периметр')
      : zones.filter(z => z.id === activeZoneId);
    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: visible.map(z => ({
          label: z.name,
          data: hourly.zones[z.id] ?? [],
          borderColor: z.color,
          backgroundColor: z.color + '20',
          tension: 0.35, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index' as const, intersect: false },
        plugins: {
          legend: { position: 'top' as const, labels: { boxWidth: 12, padding: 16 } },
          tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v: any) => fmtShort(v) } } },
      },
    };
  }, [hourly, zones, activeZoneId]);

  // ── Monthly bar (unchanged) ──────────────────────────────────────────
  const monthlyConfig = useMemo(() => {
    if (!monthly || zones.length === 0) return null;
    if (!perimId) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: MONTH_NAMES_SHORT,
        datasets: [
          { label: `${year}`,     data: monthly.current[perimId]  ?? [], backgroundColor: '#6366f1', borderRadius: 6 },
          { label: `${year - 1}`, data: monthly.previous[perimId] ?? [], backgroundColor: '#374151', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' as const, labels: { boxWidth: 12, padding: 16 } },
          tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v: any) => fmtShort(v) } } },
      },
    };
  }, [monthly, zones, year, perimId]);

  // Totals row: total for primary, compare, and delta %.
  const summary = useMemo(() => {
    if (!range) return null;
    const cur = range.zones.find(z => z.id === focusZoneId)?.total ?? 0;
    const cmp = range.compare?.zones.find(z => z.id === focusZoneId)?.total ?? null;
    const delta = cmp != null && cmp > 0 ? ((cur - cmp) / cmp) * 100 : null;
    return { cur, cmp, delta };
  }, [range, focusZoneId]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Трафик · посещаемость</h1>
          <p className="text-sm text-muted mt-1">Посетители ТРЦ в реальном времени и за период</p>
        </div>

        {/* Period picker + presets + compare */}
        <Card>
          <div className="space-y-4">
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="text-xs text-muted uppercase tracking-wider block mb-1.5">С</label>
                <input type="date" value={start} onChange={e => setStart(e.target.value)}
                       className="bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:border-accent outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-wider block mb-1.5">По</label>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                       className="bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:border-accent outline-none" />
              </div>
              <button onClick={() => loadPeriod()} className="btn-primary" disabled={loading}>
                {loading ? 'Загрузка…' : 'Применить'}
              </button>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted uppercase tracking-wider">Сравнение</span>
                <div className="inline-flex bg-surface2 border border-border rounded-lg p-0.5 text-xs">
                  {([
                    { k: 'none', l: 'Нет' },
                    { k: 'prev', l: 'Прошлый период' },
                    { k: 'year', l: 'Прошлый год' },
                  ] as { k: CompareMode; l: string }[]).map(m => (
                    <button
                      key={m.k}
                      onClick={() => setCompareMode(m.k)}
                      className={cn(
                        'px-3 py-1.5 rounded-md transition-colors',
                        compareMode === m.k ? 'bg-accent text-white' : 'text-muted hover:text-fg',
                      )}
                    >
                      {m.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Period presets — order matches Flask traffic.html */}
            <div className="flex flex-wrap gap-2">
              {presets.map(p => {
                const active = p.start === start && p.end === end;
                return (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p.start, p.end)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs border transition-colors',
                      active
                        ? 'bg-accent/20 border-accent text-white'
                        : 'bg-surface2 border-border text-muted hover:text-fg',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Zone pills */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-border/60">
              <button
                onClick={() => setActiveZoneId(null)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs border transition-colors',
                  activeZoneId === null
                    ? 'bg-accent/20 border-accent text-white'
                    : 'bg-surface2 border-border text-muted hover:text-fg',
                )}
              >
                Все зоны
              </button>
              {zones.map(z => {
                const on = activeZoneId === z.id;
                return (
                  <button
                    key={z.id}
                    onClick={() => setActiveZoneId(on ? null : z.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs border transition-colors flex items-center gap-2',
                      on ? 'text-white' : 'text-muted hover:text-fg',
                    )}
                    style={{
                      background: on ? z.color + '30' : 'var(--surface2)',
                      borderColor: on ? z.color : 'var(--border)',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />
                    {z.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Zone totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {zones.map(z => {
            const total = range?.zones.find(rz => rz.id === z.id)?.total ?? 0;
            const cmp = range?.compare?.zones.find(rz => rz.id === z.id)?.total ?? null;
            const delta = cmp != null && cmp > 0 ? ((total - cmp) / cmp) * 100 : null;
            const isActive = activeZoneId === z.id;
            return (
              <Card
                key={z.id}
                onClick={() => setActiveZoneId(isActive ? null : z.id)}
                className={cn(
                  'relative overflow-hidden cursor-pointer transition-all',
                  isActive ? 'ring-2 ring-offset-1 ring-offset-bg' : 'hover:opacity-90',
                )}
                style={isActive ? { boxShadow: `0 0 0 2px ${z.color}` } : undefined}
              >
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: z.color }} />
                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg grid place-items-center text-white font-bold text-sm"
                         style={{ background: z.color }}>
                      {z.icon}
                    </div>
                    <div className="text-xs text-muted uppercase tracking-wider truncate">{z.name}</div>
                  </div>
                  <div className="text-2xl font-bold num">{fmtInt(total)}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-muted">посещений</span>
                    {delta != null && (
                      <span className={cn(
                        'px-1.5 py-0.5 rounded num font-semibold',
                        delta >= 0 ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad',
                      )}>
                        {delta >= 0 ? '+' : ''}{fmtPct(delta)}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Daily chart */}
        <Card>
          <CardHeader
            title={`По дням · ${focusZone?.name ?? 'Периметр'}`}
            subtitle={
              summary ? (
                <>
                  Всего <span className="num font-semibold text-fg">{fmtInt(summary.cur)}</span>
                  {summary.cmp != null && (
                    <>
                      {' · сравнение: '}
                      <span className="num">{fmtInt(summary.cmp)}</span>
                      {summary.delta != null && (
                        <span className={cn(
                          'ml-2 num font-semibold',
                          summary.delta >= 0 ? 'text-good' : 'text-bad',
                        )}>
                          {summary.delta >= 0 ? '+' : ''}{fmtPct(summary.delta)}
                        </span>
                      )}
                    </>
                  )}
                </>
              ) : '—'
            }
          />
          {dailyConfig && <ChartWrap config={dailyConfig} height={320} />}
        </Card>

        {/* Day cards */}
        {dayCards.length > 0 && (
          <Card>
            <CardHeader
              title="Детализация по дням"
              subtitle={
                range?.compare
                  ? `${focusZone?.name ?? ''} · дельта vs ${range.compare.period.start} — ${range.compare.period.end}`
                  : `${focusZone?.name ?? ''} · по каждому дню периода`
              }
            />
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
              {dayCards.map(c => (
                <div key={c.date}
                     className="flex-shrink-0 w-[120px] bg-surface2 border border-border rounded-lg p-3 space-y-1">
                  <div className="text-[10px] text-muted uppercase tracking-wider">{fmtDay(c.date)}</div>
                  <div className="text-base font-semibold num">{fmtInt(c.value)}</div>
                  {c.cmp != null && (
                    <div className="text-[10px] text-muted num">vs {fmtInt(c.cmp)}</div>
                  )}
                  {c.delta != null && (
                    <div className={cn(
                      'text-[10px] font-semibold num',
                      c.delta >= 0 ? 'text-good' : 'text-bad',
                    )}>
                      {c.delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(c.delta))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Hourly chart */}
        <Card>
          <CardHeader
            title="Среднее по часам"
            subtitle={
              activeZoneId != null
                ? `${focusZone?.name} · ${start} — ${end}`
                : `Все этажи · ${start} — ${end}`
            }
          />
          {hourlyConfig && <ChartWrap config={hourlyConfig} height={340} />}
        </Card>

        {/* Monthly comparison */}
        <Card>
          <CardHeader
            title="По месяцам — сравнение с прошлым годом"
            subtitle="Общее посещение ТРЦ (по Периметру)"
            right={
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                      className="bg-surface2 border border-border rounded-lg px-3 py-1.5 text-sm focus:border-accent outline-none">
                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            }
          />
          {monthlyConfig && <ChartWrap config={monthlyConfig} height={300} />}
        </Card>
      </main>
    </>
  );
}
