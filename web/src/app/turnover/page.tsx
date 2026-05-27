'use client';

import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, fmtRub, fmtShort, fmtPct, cn } from '@/lib/utils';
import { Calendar, Trophy, Ruler, BarChart3, Search, TrendingUp, TrendingDown } from 'lucide-react';

type Yearly = {
  year: number; count: number;
  toTotal: number; toAvgPerM2: number;
  apTotal: number; apShareInTo: number;
};
type Tenant = {
  id: number; year: number;
  arendator: string | null;
  storeName: string;
  category: string | null;
  areaM2: number | null;
  toSumYear: number | null;
  toAvgMonthly: number | null;
  toPerM2: number | null;
  apWithTo: number | null;
  apShareInTo: number | null;
  avgTraffic: number | null;
  avgPurchases: number | null;
  avgCheck: number | null;
  toYoyPct: number | null;
};
type CategoryStat = {
  category: string; count: number;
  toTotal: number; toAvgPerM2: number; areaTotal: number;
};

type Tab = 'top' | 'per_m2' | 'categories' | 'yearly';

export default function TurnoverPage() {
  const [yearly, setYearly] = useState<Yearly[]>([]);
  const [year, setYear]     = useState<number | null>(null);
  const [data, setData]     = useState<{ tenants: Tenant[]; categories: CategoryStat[] } | null>(null);
  const [tab, setTab]       = useState<Tab>('top');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/turnover/summary')
      .then(r => r.json())
      .then(d => {
        setYearly(d.years);
        if (d.years.length && year == null) setYear(d.years[d.years.length - 1].year);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (year == null) return;
    setData(null);
    fetch(`/api/turnover/year/${year}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [year]);

  const cur = useMemo(() => yearly.find(y => y.year === year) ?? null, [yearly, year]);

  const filteredTenants = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.tenants;
    return data.tenants.filter(t =>
      (t.storeName ?? '').toLowerCase().includes(q) ||
      (t.arendator ?? '').toLowerCase().includes(q) ||
      (t.category ?? '').toLowerCase().includes(q),
    );
  }, [data, filter]);

  // Динамика общего ТО по годам
  const yearlyChart = useMemo(() => {
    if (yearly.length < 2) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: yearly.map(y => String(y.year)),
        datasets: [{
          label: 'Общий ТО (млн ₽)',
          data: yearly.map(y => Math.round(y.toTotal / 1e6)),
          backgroundColor: '#60a5fa',
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [yearly]);

  // Динамика среднего ТО/м²
  const perM2Chart = useMemo(() => {
    if (yearly.length < 2) return null;
    return {
      type: 'line' as const,
      data: {
        labels: yearly.map(y => String(y.year)),
        datasets: [{
          label: 'Средний ТО/м² (₽)',
          data: yearly.map(y => Math.round(y.toAvgPerM2)),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,0.15)',
          tension: 0.3, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [yearly]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Товарооборот арендаторов</h1>
            <p className="text-sm text-muted mt-1">
              Годовые показатели по магазинам: рейтинг по ТО, эффективность по м², структура по категориям.
              Источник — лист «НОВАЯ» файла 02_ТО АП.xlsx.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar size={14} className="text-muted" />
            <span className="text-sm text-muted">Год:</span>
            {yearly.map(y => (
              <button key={y.year}
                onClick={() => setYear(y.year)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  y.year === year
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-surface2 border border-border text-text hover:border-accent/30',
                )}>
                {y.year}
              </button>
            ))}
          </div>
        </div>

        {cur && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><Stat
              label="Арендаторов с ТО"
              value={fmtInt(cur.count)}
              sub={`в реестре ${cur.year}`}
            /></Card>
            <Card><Stat
              label="Общий ТО за год"
              value={fmtShort(cur.toTotal) + ' ₽'}
              sub={fmtRub(cur.toTotal)}
              accent="accent"
            /></Card>
            <Card><Stat
              label="Средний ТО/м²"
              value={fmtShort(cur.toAvgPerM2) + ' ₽'}
              sub="в месяц по арендатору"
              accent="good"
            /></Card>
            <Card><Stat
              label="АП всего"
              value={fmtShort(cur.apTotal) + ' ₽'}
              sub={`доля в ТО ~${fmtPct(cur.apShareInTo * 100, 1)}`}
            /></Card>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl overflow-x-auto">
          {([
            { id: 'top',        label: 'Топ по ТО',        Icon: Trophy },
            { id: 'per_m2',     label: 'Эффективность м²', Icon: Ruler },
            { id: 'categories', label: 'По категориям',    Icon: BarChart3 },
            { id: 'yearly',     label: 'Динамика по годам', Icon: TrendingUp },
          ] as const).map(({ id, label, Icon }) => (
            <button key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                tab === id
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-muted hover:text-text hover:bg-surface2',
              )}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Top по ТО */}
        {tab === 'top' && data && (
          <Card>
            <CardHeader
              title={`Рейтинг арендаторов по ТО · ${cur?.year ?? ''}`}
              subtitle={`Показано ${fmtInt(filteredTenants.length)} из ${fmtInt(data.tenants.length)}`}
              right={
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input type="search" value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Магазин / юр.лицо / категория"
                    className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-72" />
                </div>
              }
            />
            <div className="overflow-x-auto -mx-5 max-h-[700px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                    <th className="text-left  px-5 py-2 font-medium">#</th>
                    <th className="text-left  px-5 py-2 font-medium">Магазин</th>
                    <th className="text-left  px-5 py-2 font-medium">Категория</th>
                    <th className="text-right px-5 py-2 font-medium">м²</th>
                    <th className="text-right px-5 py-2 font-medium">ТО за год</th>
                    <th className="text-right px-5 py-2 font-medium">ТО/мес</th>
                    <th className="text-right px-5 py-2 font-medium">vs пред. год</th>
                    <th className="text-right px-5 py-2 font-medium">АП с ТО</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t, i) => (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-surface2/50">
                      <td className="px-5 py-2 num text-muted">{i + 1}</td>
                      <td className="px-5 py-2">
                        <div className="font-medium">{t.storeName}</div>
                        {t.arendator && <div className="text-xs text-muted truncate max-w-[260px]">{t.arendator}</div>}
                      </td>
                      <td className="px-5 py-2 text-xs text-muted">{t.category ?? '—'}</td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {t.areaM2 != null ? t.areaM2.toFixed(1) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num font-semibold">
                        {t.toSumYear != null ? fmtShort(t.toSumYear) + ' ₽' : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {t.toAvgMonthly != null ? fmtShort(t.toAvgMonthly) : '—'}
                      </td>
                      <td className={cn('px-5 py-2 text-right num font-semibold',
                        t.toYoyPct == null ? 'text-muted'
                        : t.toYoyPct > 1.0 ? 'text-good'
                        : t.toYoyPct < 1.0 ? 'text-bad' : 'text-muted')}>
                        {t.toYoyPct != null ? (
                          <span className="inline-flex items-center gap-1">
                            {t.toYoyPct > 1.0 ? <TrendingUp size={12} /> : t.toYoyPct < 1.0 ? <TrendingDown size={12} /> : null}
                            {fmtPct((t.toYoyPct - 1) * 100, 1)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {t.apWithTo != null ? fmtShort(t.apWithTo) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Эффективность м² */}
        {tab === 'per_m2' && data && (
          <Card>
            <CardHeader
              title={`Эффективность площади (ТО/м²) · ${cur?.year ?? ''}`}
              subtitle="Сортировка по убыванию ТО/м² — кто выжимает максимум из каждого квадратного метра"
            />
            <div className="overflow-x-auto -mx-5 max-h-[700px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                    <th className="text-left  px-5 py-2 font-medium">#</th>
                    <th className="text-left  px-5 py-2 font-medium">Магазин</th>
                    <th className="text-left  px-5 py-2 font-medium">Категория</th>
                    <th className="text-right px-5 py-2 font-medium">м²</th>
                    <th className="text-right px-5 py-2 font-medium">ТО/м²/мес</th>
                    <th className="text-right px-5 py-2 font-medium">ТО за год</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredTenants].sort((a, b) => (b.toPerM2 ?? 0) - (a.toPerM2 ?? 0)).map((t, i) => (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-surface2/50">
                      <td className="px-5 py-2 num text-muted">{i + 1}</td>
                      <td className="px-5 py-2 font-medium">{t.storeName}</td>
                      <td className="px-5 py-2 text-xs text-muted">{t.category ?? '—'}</td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {t.areaM2 != null ? t.areaM2.toFixed(1) : '—'}
                      </td>
                      <td className={cn('px-5 py-2 text-right num font-semibold',
                        (t.toPerM2 ?? 0) >= (cur?.toAvgPerM2 ?? 0) ? 'text-good' : 'text-muted')}>
                        {t.toPerM2 != null ? fmtShort(t.toPerM2) + ' ₽' : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {t.toSumYear != null ? fmtShort(t.toSumYear) + ' ₽' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* По категориям */}
        {tab === 'categories' && data && (
          <Card>
            <CardHeader
              title={`Сводка по категориям · ${cur?.year ?? ''}`}
              subtitle={`${data.categories.length} категорий`}
            />
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                    <th className="text-left  px-5 py-2 font-medium">Категория</th>
                    <th className="text-right px-5 py-2 font-medium">Магазинов</th>
                    <th className="text-right px-5 py-2 font-medium">Общая площадь м²</th>
                    <th className="text-right px-5 py-2 font-medium">ТО за год</th>
                    <th className="text-right px-5 py-2 font-medium">% от всего ТО</th>
                    <th className="text-right px-5 py-2 font-medium">Средний ТО/м²</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
                      <td className="px-5 py-2 font-medium">{c.category}</td>
                      <td className="px-5 py-2 text-right num text-muted">{c.count}</td>
                      <td className="px-5 py-2 text-right num text-muted">{Math.round(c.areaTotal)}</td>
                      <td className="px-5 py-2 text-right num font-semibold">{fmtShort(c.toTotal)} ₽</td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {cur ? fmtPct((c.toTotal / cur.toTotal) * 100, 1) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num">{fmtShort(c.toAvgPerM2)} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Динамика по годам */}
        {tab === 'yearly' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Общий ТО по годам, млн ₽" />
              {yearlyChart
                ? <ChartWrap config={yearlyChart} height={320} />
                : <div className="text-sm text-muted text-center py-12">Нужно ≥ 2 года</div>}
            </Card>
            <Card>
              <CardHeader title="Средний ТО с м², ₽" subtitle="по арендаторам" />
              {perM2Chart
                ? <ChartWrap config={perM2Chart} height={320} />
                : <div className="text-sm text-muted text-center py-12">Нужно ≥ 2 года</div>}
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Сводка по всем годам" />
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                      <th className="text-left  px-5 py-2 font-medium">Год</th>
                      <th className="text-right px-5 py-2 font-medium">Арендаторов</th>
                      <th className="text-right px-5 py-2 font-medium">Общий ТО</th>
                      <th className="text-right px-5 py-2 font-medium">Средний ТО/м²</th>
                      <th className="text-right px-5 py-2 font-medium">АП всего</th>
                      <th className="text-right px-5 py-2 font-medium">Средняя доля АП в ТО</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearly.map(y => (
                      <tr key={y.year} className="border-b border-border/50 hover:bg-surface2/50">
                        <td className="px-5 py-2 num font-semibold">
                          <button onClick={() => setYear(y.year)}
                            className={cn('hover:text-accent', year === y.year && 'text-accent')}>
                            {y.year}
                          </button>
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">{y.count}</td>
                        <td className="px-5 py-2 text-right num font-semibold">{fmtShort(y.toTotal)} ₽</td>
                        <td className="px-5 py-2 text-right num">{fmtShort(y.toAvgPerM2)} ₽</td>
                        <td className="px-5 py-2 text-right num text-muted">{fmtShort(y.apTotal)} ₽</td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {fmtPct(y.apShareInTo * 100, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </main>
    </>
  );
}
