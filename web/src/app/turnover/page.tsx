'use client';

import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, fmtRub, fmtShort, fmtPct, cn } from '@/lib/utils';
import { Calendar, Trophy, Ruler, Search, TrendingUp, TrendingDown, CalendarDays, X, Store, Layers, CalendarRange } from 'lucide-react';

const MONTH_NAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function periodLabel(min: number | null, max: number | null): string {
  if (!min || !max) return '—';
  return min === max ? MONTH_NAMES_SHORT[min - 1] : `${MONTH_NAMES_SHORT[min - 1]}–${MONTH_NAMES_SHORT[max - 1]}`;
}

type Yearly = {
  year: number; count: number;
  toTotal: number; toAvgPerM2: number;
  apTotal: number; apShareInTo: number;
};

// Tenant с корректным сравнением период-в-период (см. turnover.ts).
type Tenant = {
  storeName: string;
  arendator: string | null;
  category: string | null;
  areaM2: number | null;
  toPerM2: number | null;
  apWithTo: number | null;
  toPeriodCur: number | null;
  curMonths: number;
  periodMin: number | null;
  periodMax: number | null;
  curMatched: number | null;
  prevMatched: number | null;
  matchedMonths: number;
};

// YoY считаем сами: ТО за совпадающие месяцы этого года ÷ те же месяцы
// прошлого − 1. null, если сопоставлять не с чем (новый магазин).
function periodYoY(t: Tenant): number | null {
  if (t.matchedMonths > 0 && t.prevMatched && t.prevMatched > 0 && t.curMatched != null) {
    return t.curMatched / t.prevMatched - 1;
  }
  return null;
}

type Tab = 'top' | 'per_m2' | 'monthly';

type MonthlyTotal = {
  month: number; toTotal: number; toPerM2Avg: number;
  storesCount: number; toLastYear: number; yoyPct: number | null;
};
type StoreMonthlyRow = {
  storeName: string; category: string | null; areaM2: number | null;
  toYearTotal: number; m: (number | null)[];
};
type HeatRow = {
  label: string; sublabel: string | null;
  m: (number | null)[]; total: number;
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
  const [data, setData]     = useState<{ tenants: Tenant[] } | null>(null);
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
    // AbortController защищает от race-condition при быстром переключении года.
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

  // Общий период текущего года (для заголовка колонки «ТО за …»).
  const period = useMemo(() => {
    if (!data || !data.tenants.length) return null;
    let mn = 13, mx = 0;
    for (const t of data.tenants) {
      if (t.periodMin != null) mn = Math.min(mn, t.periodMin);
      if (t.periodMax != null) mx = Math.max(mx, t.periodMax);
    }
    if (mx === 0) return null;
    return { min: mn, max: mx, label: periodLabel(mn, mx), full: mn === 1 && mx === 12 };
  }, [data]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Товарооборот арендаторов</h1>
            <p className="text-sm text-muted mt-1">
              Рейтинг по ТО с честным сравнением период-в-период и сезонная карта.
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
              label={period && !period.full ? `Общий ТО · ${period.label}` : 'Общий ТО за год'}
              value={fmtShort(cur.toTotal) + ' ₽'}
              sub={period && !period.full ? `период ${period.label} ${cur.year}` : fmtRub(cur.toTotal)}
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
            { id: 'top',     label: 'Топ по ТО',        Icon: Trophy },
            { id: 'per_m2',  label: 'Эффективность м²', Icon: Ruler },
            { id: 'monthly', label: 'Сезонная карта',   Icon: CalendarDays },
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
              subtitle={
                period && !period.full
                  ? `Сравнение период-в-период: ${period.label} ${cur?.year} против ${period.label} ${(cur?.year ?? 0) - 1}. Готовый YoY из Excel не используется.`
                  : `Сравнение с тем же периодом прошлого года (считается из помесячных данных, а не из Excel).`
              }
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
                    <th className="text-right px-5 py-2 font-medium">
                      ТО{period ? ` ${period.label}` : ''}
                    </th>
                    <th className="text-right px-5 py-2 font-medium">ТО/мес</th>
                    <th className="text-right px-5 py-2 font-medium">vs пред. год</th>
                    <th className="text-right px-5 py-2 font-medium">АП с ТО</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t, i) => {
                    const yoy = periodYoY(t);
                    const perMonth = t.toPeriodCur != null && t.curMonths > 0
                      ? t.toPeriodCur / t.curMonths : null;
                    return (
                      <tr key={t.storeName} className="border-b border-border/50 hover:bg-surface2/50">
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
                          {t.toPeriodCur != null ? fmtShort(t.toPeriodCur) + ' ₽' : '—'}
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {perMonth != null ? fmtShort(perMonth) : '—'}
                        </td>
                        <td className={cn('px-5 py-2 text-right num font-semibold',
                          yoy == null ? 'text-muted'
                          : yoy > 0 ? 'text-good'
                          : yoy < 0 ? 'text-bad' : 'text-muted')}
                          title={yoy != null
                            ? `${periodLabel(t.periodMin, t.periodMax)} ${cur?.year}: ${fmtRub(t.curMatched)} · ${periodLabel(t.periodMin, t.periodMax)} ${(cur?.year ?? 0) - 1}: ${fmtRub(t.prevMatched)} (${t.matchedMonths} мес.)`
                            : t.matchedMonths === 0 ? 'нет данных за прошлый год — новый магазин' : ''}>
                          {yoy != null ? (
                            <span className="inline-flex items-center gap-1">
                              {yoy > 0 ? <TrendingUp size={12} /> : yoy < 0 ? <TrendingDown size={12} /> : null}
                              {(yoy > 0 ? '+' : '') + fmtPct(yoy * 100, 1)}
                            </span>
                          ) : <span className="text-xs">новый</span>}
                        </td>
                        <td className="px-5 py-2 text-right num text-muted">
                          {t.apWithTo != null ? fmtShort(t.apWithTo) : '—'}
                        </td>
                      </tr>
                    );
                  })}
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
                    <th className="text-right px-5 py-2 font-medium">ТО{period ? ` ${period.label}` : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredTenants].sort((a, b) => (b.toPerM2 ?? 0) - (a.toPerM2 ?? 0)).map((t, i) => (
                    <tr key={t.storeName} className="border-b border-border/50 hover:bg-surface2/50">
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
                        {t.toPeriodCur != null ? fmtShort(t.toPeriodCur) + ' ₽' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Сезонная карта */}
        {tab === 'monthly' && (
          <MonthlyTab
            year={year}
            monthlyData={monthlyData}
            onDrillStore={setDrillStore}
            onPickYear={setYear}
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
      </main>
    </>
  );
}


// ── Сезонная карта: KPI + график ТРЦ + тепловая карта в трёх режимах ───
//   Режимы: по магазинам / по годам / по категориям. Метрика: ₽ ТО или ТО/м².
//   Цвет ячейки — индекс месяца к среднему по строке (нормализация),
//   поэтому строки разного масштаба сравниваются в одной шкале.
type HeatMode = 'store' | 'year' | 'category';
type HeatMetric = 'to_sum' | 'to_per_m2';

function MonthlyTab({
  year, monthlyData, onDrillStore, onPickYear,
}: {
  year: number | null;
  monthlyData: { totals: MonthlyTotal[]; matrix: StoreMonthlyRow[] } | null;
  onDrillStore: (s: string) => void;
  onPickYear: (y: number) => void;
}) {
  const [filter, setFilter] = useState('');
  const [topN, setTopN]     = useState(30);
  const [mode, setMode]     = useState<HeatMode>('store');
  const [metric, setMetric] = useState<HeatMetric>('to_sum');
  const [heatRows, setHeatRows] = useState<HeatRow[] | null>(null);

  const matrix = monthlyData?.matrix;

  // Источник строк тепловой карты по режиму/метрике.
  useEffect(() => {
    // store + ₽ ТО — уже загруженная матрица, без доп. запроса.
    if (mode === 'store' && metric === 'to_sum') {
      setHeatRows((matrix ?? []).map(s => ({
        label: s.storeName, sublabel: s.category, m: s.m, total: s.toYearTotal,
      })));
      return;
    }
    if (year == null) return;
    const ctrl = new AbortController();
    setHeatRows(null);
    const url =
      mode === 'store'    ? `/api/turnover/year/${year}/monthly?metric=${metric}`
      : mode === 'year'   ? `/api/turnover/heatmap?mode=year&metric=${metric}`
      :                     `/api/turnover/heatmap?mode=category&year=${year}&metric=${metric}`;
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        if (mode === 'store') {
          setHeatRows((d.matrix as StoreMonthlyRow[]).map(s => ({
            label: s.storeName, sublabel: s.category, m: s.m, total: s.toYearTotal,
          })));
        } else {
          setHeatRows(d.rows as HeatRow[]);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [mode, metric, year, matrix]);

  if (!monthlyData) {
    return <Card><div className="text-sm text-muted text-center py-6">Загрузка…</div></Card>;
  }

  const { totals } = monthlyData;
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
        y:  { beginAtZero: true, title: { display: true, text: 'ТО, млн ₽' } },
        y1: { position: 'right' as const, grid: { drawOnChartArea: false },
              title: { display: true, text: 'YoY, %' },
              ticks: { callback: (v: string | number) => v + '%' } },
      },
    },
  };

  // Фильтрация и срез строк тепловой карты. topN — только для магазинов.
  const rows = heatRows ?? [];
  const searchable = mode !== 'year';
  const filteredRows = rows.filter(s => {
    if (!searchable || !filter.trim()) return true;
    const q = filter.toLowerCase();
    return s.label.toLowerCase().includes(q) || (s.sublabel ?? '').toLowerCase().includes(q);
  });
  const shownRows = mode === 'store' ? filteredRows.slice(0, topN) : filteredRows;

  const metricUnit = metric === 'to_per_m2' ? 'ТО/м²' : '₽';
  const totalColLabel = metric === 'to_per_m2' ? 'средн.' : '∑';
  const modeTitle =
    mode === 'store'    ? 'топ магазинов × месяцы'
    : mode === 'year'   ? 'годы × месяцы (весь ТРЦ)'
    :                     'категории × месяцы';

  function onRowClick(label: string) {
    if (mode === 'store') onDrillStore(label);
    else if (mode === 'year') onPickYear(Number(label));
    // для категорий клика нет
  }

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
          title={`Сезонная карта · ${modeTitle}`}
          subtitle="Цвет — индекс месяца к среднему по строке (синий = ниже, зелёный = средний, жёлтый/красный = пик)."
          right={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Режим */}
              <div className="flex gap-1 p-1 bg-surface2 border border-border rounded-lg">
                {([
                  { id: 'store',    label: 'Магазины',   Icon: Store },
                  { id: 'year',     label: 'Годы',       Icon: CalendarRange },
                  { id: 'category', label: 'Категории',  Icon: Layers },
                ] as const).map(({ id, label, Icon }) => (
                  <button key={id} onClick={() => setMode(id)}
                    className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                      mode === id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
              {/* Метрика */}
              <div className="flex gap-1 p-1 bg-surface2 border border-border rounded-lg">
                {([
                  { id: 'to_sum',    label: '₽ ТО' },
                  { id: 'to_per_m2', label: 'ТО/м²' },
                ] as const).map(({ id, label }) => (
                  <button key={id} onClick={() => setMetric(id)}
                    className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                      metric === id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                    {label}
                  </button>
                ))}
              </div>
              {mode === 'store' && (
                <select value={topN} onChange={e => setTopN(Number(e.target.value))}
                  className="bg-surface2 border border-border rounded-lg px-2 py-1.5 text-sm">
                  <option value={10}>топ 10</option>
                  <option value={20}>топ 20</option>
                  <option value={30}>топ 30</option>
                  <option value={50}>топ 50</option>
                  <option value={9999}>все</option>
                </select>
              )}
              {searchable && (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input type="search" value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder={mode === 'category' ? 'Категория' : 'Магазин / категория'}
                    className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-52" />
                </div>
              )}
            </div>
          }
        />
        {heatRows == null ? (
          <div className="text-sm text-muted text-center py-10">Загрузка…</div>
        ) : (
          <HeatTable
            rows={shownRows}
            metricUnit={metricUnit}
            totalColLabel={totalColLabel}
            clickable={mode !== 'category'}
            onRowClick={onRowClick}
          />
        )}
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


// ── Тепловая карта: одна таблица для всех трёх режимов ─────────────────
function HeatTable({
  rows, metricUnit, totalColLabel, clickable, onRowClick,
}: {
  rows: HeatRow[];
  metricUnit: string;
  totalColLabel: string;
  clickable: boolean;
  onRowClick: (label: string) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-xs">
        <thead className="bg-surface">
          <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-border">
            <th className="text-left px-3 py-2 font-medium sticky left-0 bg-surface">Строка</th>
            {MONTH_NAMES_SHORT.map(n => (
              <th key={n} className="text-center px-1 py-2 font-medium w-12">{n}</th>
            ))}
            <th className="text-right px-3 py-2 font-medium">{totalColLabel} за год</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const vals = row.m.filter((v): v is number => v != null && v > 0);
            const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
            return (
              <tr key={row.label}
                  onClick={() => clickable && onRowClick(row.label)}
                  className={cn('border-b border-border/30 hover:bg-surface2/40',
                    clickable && 'cursor-pointer')}>
                <td className="px-3 py-1.5 sticky left-0 bg-surface max-w-[200px] truncate" title={row.label}>
                  <div className="font-medium truncate">{row.label}</div>
                  {row.sublabel && <div className="text-[9px] text-muted/70 truncate">{row.sublabel}</div>}
                </td>
                {row.m.map((v, i) => {
                  const idx = avg > 0 && v != null ? v / avg : 0;
                  const bg = v == null ? 'transparent'
                    : idx < 0.7  ? 'rgba(96, 165, 250, 0.20)'
                    : idx < 0.95 ? 'rgba(52, 211, 153, 0.15)'
                    : idx < 1.15 ? 'rgba(52, 211, 153, 0.45)'
                    : idx < 1.35 ? 'rgba(251, 191, 36, 0.55)'
                    :              'rgba(239, 68, 68, 0.55)';
                  return (
                    <td key={i}
                        style={{ background: bg }}
                        className="text-center px-1 py-1.5 num"
                        title={v != null ? `${MONTH_NAMES_SHORT[i]}: ${fmtRub(v)} ${metricUnit}, индекс ${(idx*100).toFixed(0)}%` : ''}>
                      {v != null ? fmtShort(v) : '—'}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right num font-semibold">{fmtShort(row.total)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={14} className="text-center text-muted py-6">Ничего не найдено</td></tr>
          )}
        </tbody>
      </table>
    </div>
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
