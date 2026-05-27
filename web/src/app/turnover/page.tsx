'use client';

import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, fmtRub, fmtShort, fmtPct, cn } from '@/lib/utils';
import { Calendar, Trophy, Ruler, BarChart3, Search, TrendingUp, TrendingDown, CalendarDays, X } from 'lucide-react';

const MONTH_NAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

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

type Tab = 'top' | 'per_m2' | 'categories' | 'yearly' | 'monthly';

type MonthlyTotal = {
  month: number; toTotal: number; toPerM2Avg: number;
  storesCount: number; toLastYear: number; yoyPct: number | null;
};
type StoreMonthlyRow = {
  storeName: string; category: string | null; areaM2: number | null;
  toYearTotal: number; m: (number | null)[];
};
type StoreMonthlyTimelinePoint = {
  year: number; month: number;
  toSum: number | null; toPerM2: number | null;
  yoyPct: number | null; momPct: number | null;
  purchases: number | null; ap: number | null;
};

export default function TurnoverPage() {
  const [yearly, setYearly] = useState<Yearly[]>([]);
  const [year, setYear]     = useState<number | null>(null);
  const [data, setData]     = useState<{ tenants: Tenant[]; categories: CategoryStat[] } | null>(null);
  const [tab, setTab]       = useState<Tab>('top');
  const [filter, setFilter] = useState('');
  const [monthlyData, setMonthlyData] = useState<{ totals: MonthlyTotal[]; matrix: StoreMonthlyRow[] } | null>(null);
  const [drillStore, setDrillStore] = useState<string | null>(null);
  const [drillData, setDrillData]   = useState<StoreMonthlyTimelinePoint[] | null>(null);

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
    // AbortController защищает от race-condition при быстром переключении
    // года: старый ответ не затрёт новый (см. code review).
    const ctrl = new AbortController();
    setData(null);
    setMonthlyData(null);
    fetch(`/api/turnover/year/${year}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
    fetch(`/api/turnover/year/${year}/monthly`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(setMonthlyData)
      .catch(() => {});
    return () => ctrl.abort();
  }, [year]);

  useEffect(() => {
    if (!drillStore) { setDrillData(null); return; }
    const ctrl = new AbortController();
    setDrillData(null);
    fetch(`/api/turnover/store/${encodeURIComponent(drillStore)}/monthly`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => setDrillData(d.monthly))
      .catch(() => {});
    return () => ctrl.abort();
  }, [drillStore]);

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
            { id: 'top',        label: 'Топ по ТО',         Icon: Trophy },
            { id: 'per_m2',     label: 'Эффективность м²',  Icon: Ruler },
            { id: 'monthly',    label: 'По месяцам',         Icon: CalendarDays },
            { id: 'categories', label: 'По категориям',     Icon: BarChart3 },
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
                        {cur && cur.toTotal > 0
                          ? fmtPct((c.toTotal / cur.toTotal) * 100, 1)
                          : '—'}
                      </td>
                      <td className="px-5 py-2 text-right num">{fmtShort(c.toAvgPerM2)} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* По месяцам */}
        {tab === 'monthly' && (
          <MonthlyTab
            year={year}
            monthlyData={monthlyData}
            onDrillStore={setDrillStore}
          />
        )}

        {/* Drill-down: модал с timeline одного магазина */}
        {drillStore && (
          <StoreDrillModal
            store={drillStore}
            data={drillData}
            onClose={() => setDrillStore(null)}
          />
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


// ── MonthlyTab: сезонная аналитика по выбранному году ──────────────────
// 4 секции:
//   1. KPI: общий ТО за период, средний YoY%, лучший/худший месяц
//   2. График: общий ТО ТРЦ помесячно + YoY overlay
//   3. Сезонная heatmap: top-30 магазинов × 12 месяцев, цвет — индекс к
//      среднему месяцу магазина (нормализация позволяет сравнивать магазины
//      разного размера в одной шкале).
//   4. Drill-down: клик по строке → модал с полной timeline магазина по
//      годам.
function MonthlyTab({
  year, monthlyData, onDrillStore,
}: {
  year: number | null;
  monthlyData: { totals: MonthlyTotal[]; matrix: StoreMonthlyRow[] } | null;
  onDrillStore: (s: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [topN, setTopN]     = useState(30);

  if (!monthlyData) {
    return <Card><div className="text-sm text-muted text-center py-6">Загрузка…</div></Card>;
  }

  const { totals, matrix } = monthlyData;
  if (!totals.length) {
    return <Card><div className="text-sm text-muted text-center py-6">
      Помесячных данных за {year} пока нет.
    </div></Card>;
  }

  // KPI помесячного периода
  const totalSum    = totals.reduce((s, m) => s + m.toTotal, 0);
  const monthsWithData = totals.filter(m => m.toTotal > 0).length;
  const validYoY    = totals.filter(m => m.yoyPct != null).map(m => m.yoyPct!);
  const avgYoY      = validYoY.length ? validYoY.reduce((s, x) => s + x, 0) / validYoY.length : 0;
  const sortedByTo  = [...totals].filter(m => m.toTotal > 0).sort((a, b) => b.toTotal - a.toTotal);
  const bestMonth   = sortedByTo[0];
  const worstMonth  = sortedByTo[sortedByTo.length - 1];

  // График: ТО по месяцам этого года и предыдущего года + YoY %
  const monthlyChart = {
    type: 'bar' as const,
    data: {
      labels: totals.map(t => MONTH_NAMES_SHORT[t.month - 1]),
      datasets: [
        { label: String(year),       data: totals.map(t => Math.round(t.toTotal / 1e6)),
          backgroundColor: '#60a5fa', borderRadius: 6, order: 2 },
        { label: String((year ?? 0) - 1), data: totals.map(t => Math.round(t.toLastYear / 1e6)),
          backgroundColor: 'rgba(148,163,184,0.4)', borderRadius: 6, order: 3 },
        { label: 'YoY %', type: 'line' as const, yAxisID: 'y1',
          data: totals.map(t => t.yoyPct == null ? null : Math.round(t.yoyPct * 10) / 10),
          borderColor: '#fbbf24', backgroundColor: '#fbbf24',
          borderWidth: 2, tension: 0.3, pointRadius: 3, spanGaps: true, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' as const } },
      scales: {
        y:  { beginAtZero: true,
              title: { display: true, text: 'ТО, млн ₽' } },
        y1: { position: 'right' as const,
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'YoY, %' },
              ticks: { callback: (v: string | number) => v + '%' } },
      },
    },
  };

  // Heatmap: матрица store × month, цвет нормализован к среднему месяцу
  // магазина. Это даёт «индекс сезонности» — выше/ниже среднего по магазину.
  const filteredMatrix = matrix
    .filter(s => {
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return s.storeName.toLowerCase().includes(q) ||
             (s.category ?? '').toLowerCase().includes(q);
    })
    .slice(0, topN);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><Stat
          label="Сумма ТО за период"
          value={fmtShort(totalSum) + ' ₽'}
          sub={`${monthsWithData} мес. с данными`}
          accent="accent"
        /></Card>
        <Card><Stat
          label="Средний YoY"
          value={(avgYoY > 0 ? '+' : '') + avgYoY.toFixed(1) + '%'}
          sub="по месяцам, где есть пред. год"
          accent={avgYoY > 0 ? 'good' : avgYoY < 0 ? 'bad' : undefined}
        /></Card>
        <Card><Stat
          label="Лучший месяц"
          value={bestMonth ? MONTH_NAMES_SHORT[bestMonth.month - 1] : '—'}
          sub={bestMonth ? fmtShort(bestMonth.toTotal) + ' ₽' : ''}
          accent="good"
        /></Card>
        <Card><Stat
          label="Худший месяц"
          value={worstMonth ? MONTH_NAMES_SHORT[worstMonth.month - 1] : '—'}
          sub={worstMonth ? fmtShort(worstMonth.toTotal) + ' ₽' : ''}
          accent="warn"
        /></Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Общий ТО ТРЦ помесячно · ${year}`}
          subtitle="Сравнение с предыдущим годом + YoY% на правой оси"
        />
        <ChartWrap config={monthlyChart} height={340} />
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Сезонная карта · топ магазинов × месяцы"
          subtitle="Цвет — индекс месяца к среднему этого магазина (синий = ниже, зелёный = средний, жёлтый/красный = пик). Клик по строке — полная история магазина."
          right={
            <div className="flex items-center gap-2">
              <select value={topN} onChange={e => setTopN(Number(e.target.value))}
                className="bg-surface2 border border-border rounded-lg px-2 py-1.5 text-sm">
                <option value={10}>топ 10</option>
                <option value={20}>топ 20</option>
                <option value={30}>топ 30</option>
                <option value={50}>топ 50</option>
                <option value={9999}>все</option>
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input type="search" value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Магазин / категория"
                  className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-56" />
              </div>
            </div>
          }
        />
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-xs">
            <thead className="bg-surface">
              <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-border">
                <th className="text-left  px-3 py-2 font-medium sticky left-0 bg-surface">Магазин</th>
                {MONTH_NAMES_SHORT.map(n => (
                  <th key={n} className="text-center px-1 py-2 font-medium w-12">{n}</th>
                ))}
                <th className="text-right px-3 py-2 font-medium">∑ за год</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatrix.map(row => {
                const vals = row.m.filter((v): v is number => v != null && v > 0);
                const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
                return (
                  <tr key={row.storeName}
                      onClick={() => onDrillStore(row.storeName)}
                      className="border-b border-border/30 hover:bg-surface2/40 cursor-pointer">
                    <td className="px-3 py-1.5 sticky left-0 bg-surface group-hover:bg-surface2/40 max-w-[200px] truncate"
                        title={row.storeName}>
                      <div className="font-medium truncate">{row.storeName}</div>
                      {row.category && <div className="text-[9px] text-muted/70 truncate">{row.category}</div>}
                    </td>
                    {row.m.map((v, i) => {
                      const idx = avg > 0 && v != null ? v / avg : 0;
                      // 5-step gradient: blue → green → yellow → orange → red
                      const bg = v == null ? 'transparent'
                        : idx < 0.7  ? 'rgba(96, 165, 250, 0.20)'   // ниже среднего
                        : idx < 0.95 ? 'rgba(52, 211, 153, 0.15)'   // слегка ниже
                        : idx < 1.15 ? 'rgba(52, 211, 153, 0.45)'   // средний
                        : idx < 1.35 ? 'rgba(251, 191, 36, 0.55)'   // выше
                        :              'rgba(239, 68, 68, 0.55)';   // пик
                      return (
                        <td key={i}
                            style={{ background: bg }}
                            className="text-center px-1 py-1.5 num"
                            title={v != null ? `${MONTH_NAMES_SHORT[i]}: ${fmtRub(v)}, индекс ${(idx*100).toFixed(0)}%` : ''}>
                          {v != null ? fmtShort(v) : '—'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right num font-semibold">{fmtShort(row.toYearTotal)}</td>
                  </tr>
                );
              })}
              {filteredMatrix.length === 0 && (
                <tr><td colSpan={14} className="text-center text-muted py-6">
                  Ничего не найдено
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-muted flex items-center gap-3 flex-wrap">
          <span>Легенда:</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: 'rgba(96, 165, 250, 0.20)' }}/> &lt;70% от среднего
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: 'rgba(52, 211, 153, 0.45)' }}/> ~средний
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: 'rgba(251, 191, 36, 0.55)' }}/> +15%
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: 'rgba(239, 68, 68, 0.55)' }}/> +35% пик
          </span>
        </div>
      </Card>
    </>
  );
}


// ── Drill-down: полная история магазина по всем месяцам всех годов ─────
function StoreDrillModal({
  store, data, onClose,
}: {
  store: string;
  data: StoreMonthlyTimelinePoint[] | null;
  onClose: () => void;
}) {
  // График: ТО по месяцам всех годов как одна линия + столбики покупок
  const chart = useMemo(() => {
    if (!data || data.length < 2) return null;
    const labels = data.map(p => `${MONTH_NAMES_SHORT[p.month - 1]} ${String(p.year).slice(2)}`);
    return {
      type: 'bar' as const,
      data: {
        labels,
        datasets: [
          { label: 'ТО, тыс ₽', type: 'bar' as const,
            data: data.map(p => p.toSum != null ? Math.round(p.toSum / 1000) : null),
            backgroundColor: '#60a5fa', borderRadius: 4, order: 2 },
          { label: 'Кол-во покупок', type: 'line' as const, yAxisID: 'y1',
            data: data.map(p => p.purchases ?? null),
            borderColor: '#fbbf24', borderWidth: 2, tension: 0.3,
            pointRadius: 2, spanGaps: true, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' as const } },
        scales: {
          y:  { beginAtZero: true, title: { display: true, text: 'ТО, тыс ₽' } },
          y1: { position: 'right' as const, grid: { drawOnChartArea: false },
                title: { display: true, text: 'Покупок' } },
        },
      },
    };
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{store}</h2>
            <p className="text-xs text-muted mt-1">Помесячная история по всем годам</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text p-1">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          {data == null ? (
            <div className="text-sm text-muted text-center py-12">Загрузка…</div>
          ) : data.length === 0 ? (
            <div className="text-sm text-muted text-center py-12">Нет помесячных данных по этому магазину</div>
          ) : (
            <>
              {chart && (
                <div className="mb-6">
                  <ChartWrap config={chart} height={320} />
                </div>
              )}
              <div className="overflow-x-auto -mx-5 max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                      <th className="text-left  px-5 py-2 font-medium">Период</th>
                      <th className="text-right px-5 py-2 font-medium">ТО</th>
                      <th className="text-right px-5 py-2 font-medium">ТО/м²</th>
                      <th className="text-right px-5 py-2 font-medium">YoY %</th>
                      <th className="text-right px-5 py-2 font-medium">MoM %</th>
                      <th className="text-right px-5 py-2 font-medium">Покупок</th>
                      <th className="text-right px-5 py-2 font-medium">АП</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data].reverse().map((p, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
                        <td className="px-5 py-2 num">{MONTH_NAMES_SHORT[p.month - 1]} {p.year}</td>
                        <td className="px-5 py-2 text-right num font-semibold">
                          {p.toSum != null ? fmtShort(p.toSum) + ' ₽' : '—'}
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {p.toPerM2 != null ? fmtShort(p.toPerM2) : '—'}
                        </td>
                        <td className={cn('px-5 py-2 text-right num',
                          p.yoyPct == null ? 'text-muted'
                          : p.yoyPct > 1 ? 'text-good'
                          : p.yoyPct < 1 ? 'text-bad' : 'text-muted')}>
                          {p.yoyPct != null && p.yoyPct > 0 ? fmtPct((p.yoyPct - 1) * 100, 1) : '—'}
                        </td>
                        <td className={cn('px-5 py-2 text-right num',
                          p.momPct == null ? 'text-muted'
                          : p.momPct > 1 ? 'text-good'
                          : p.momPct < 1 ? 'text-bad' : 'text-muted')}>
                          {p.momPct != null && p.momPct > 0 ? fmtPct((p.momPct - 1) * 100, 1) : '—'}
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {p.purchases != null ? fmtInt(p.purchases) : '—'}
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {p.ap != null ? fmtShort(p.ap) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
