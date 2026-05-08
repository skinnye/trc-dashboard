'use client';

import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, fmtPct, fmtRub, fmtShort, cn } from '@/lib/utils';
import {
  Calendar, Search, Building2, AlertTriangle,
  PieChart, ArrowLeftRight, LayoutGrid, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';

// ── Общие типы ────────────────────────────────────────────────────────
type Monthly = {
  year: number; month: number;
  rented: number; vacant: number; total: number;
  pct: number; pctArea: number;
  rentedAreaM2: number; vacantAreaM2: number;
};
type Yearly = {
  year: number; months: number;
  avgPct: number; avgPctArea: number;
  avgRentedArea: number; avgVacantArea: number;
};
type VacantRoom = {
  room: string; floor: string | null;
  vacantMonths: number; rentedMonths: number; totalMonths: number;
  pctVacant: number; lastVacantPeriod: string | null;
  avgArea: number | null;
};
type RoomMonth = {
  year: number; month: number;
  status: 'rented' | 'not_rented' | 'other';
  statusRaw: string | null;
  legalName: string | null; tradeName: string | null;
  areaM2: number | null;
};
type YearMovement = {
  year: number;
  arrivals: number; departures: number; netCount: number;
  arrivalsAreaM2: number; departuresAreaM2: number; netAreaM2: number;
  arrivalsCharges: number; departuresCharges: number; netCharges: number;
};
type Movement = {
  id: number; year: number; kind: 'departure' | 'arrival';
  seqNo: number | null; floor: string | null; room: string | null;
  areaM2: number | null; ratePerM2: number | null;
  legalName: string | null; tradeName: string | null;
  chargesNoVat: number | null; chargesWithVat: number | null;
  eventDate: string | null; dateRaw: string | null;
};
type MonthPoint = { year: number; month: number; arrivals: number; departures: number };

const MONTH_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// ── Главная страница ──────────────────────────────────────────────────
type Tab = 'occupancy' | 'movements' | 'rooms';

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('occupancy');

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Заполняемость и движение арендаторов</h1>
          <p className="text-sm text-muted mt-1">
            Историческая статистика статуса помещений (Сдан / Не сдан) и реестр
            съездов/заездов арендаторов за все доступные годы.
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl overflow-x-auto">
          {([
            { id: 'occupancy',  label: 'Заполняемость',  Icon: PieChart },
            { id: 'movements',  label: 'Съезды и заезды', Icon: ArrowLeftRight },
            { id: 'rooms',      label: 'Помещения',       Icon: LayoutGrid },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                tab === id
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-muted hover:text-text hover:bg-surface2',
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'occupancy' && <OccupancyTab />}
        {tab === 'movements' && <MovementsTab />}
        {tab === 'rooms'     && <RoomsTab />}
      </main>
    </>
  );
}

// ── Таб «Заполняемость» ───────────────────────────────────────────────
function OccupancyTab() {
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [yearly, setYearly]   = useState<Yearly[]>([]);

  useEffect(() => {
    fetch('/api/occupancy/timeline').then(r => r.json())
      .then(d => { setMonthly(d.monthly); setYearly(d.yearly); })
      .catch(() => {});
  }, []);

  const timelineChart = useMemo(() => {
    if (monthly.length < 2) return null;
    const labels = monthly.map(p => `${MONTH_SHORT[p.month - 1]} ${String(p.year).slice(2)}`);
    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: [
          { label: '% сдано (по комнатам)', data: monthly.map(p => p.pct),
            borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', tension: 0.3, fill: true },
          { label: '% сдано (по площади)',  data: monthly.map(p => p.pctArea),
            borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)', tension: 0.3, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' as const } },
        scales: { y: { min: 50, max: 100, ticks: { callback: (v: string | number) => v + '%' } } },
      },
    };
  }, [monthly]);

  const yearlyChart = useMemo(() => {
    if (yearly.length < 2) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: yearly.map(y => String(y.year)),
        datasets: [
          { label: 'Сдано м² (среднем.)',   data: yearly.map(y => Math.round(y.avgRentedArea)),
            backgroundColor: '#34d399', borderRadius: 6, stack: 'a' },
          { label: 'Свободно м² (среднем.)', data: yearly.map(y => Math.round(y.avgVacantArea)),
            backgroundColor: '#f87171', borderRadius: 6, stack: 'a' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' as const } },
        scales: { x: { stacked: true }, y: { stacked: true } },
      },
    };
  }, [yearly]);

  const latest = monthly[monthly.length - 1];

  return (
    <>
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><Stat
            label="Последний месяц"
            value={`${MONTH_SHORT[latest.month - 1]} ${latest.year}`}
            sub={<><Calendar size={11} className="inline mr-1" /></>}
          /></Card>
          <Card><Stat
            label="Заполняемость"
            value={fmtPct(latest.pct, 1)}
            sub={`${latest.rented} из ${latest.total} помещений`}
            accent={latest.pct >= 85 ? 'good' : latest.pct >= 70 ? 'warn' : 'bad'}
          /></Card>
          <Card><Stat
            label="По площади"
            value={fmtPct(latest.pctArea, 1)}
            sub={`${Math.round(latest.rentedAreaM2)} м² из ${Math.round(latest.rentedAreaM2 + latest.vacantAreaM2)}`}
            accent={latest.pctArea >= 85 ? 'good' : latest.pctArea >= 70 ? 'warn' : 'bad'}
          /></Card>
          <Card><Stat
            label="Свободно"
            value={`${latest.vacant}`}
            sub={`${Math.round(latest.vacantAreaM2)} м²`}
            accent={latest.vacant > 50 ? 'bad' : 'warn'}
          /></Card>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader title="Помесячная занятость, %" subtitle={`${monthly.length} точек`} />
          {timelineChart
            ? <ChartWrap config={timelineChart} height={320} />
            : <div className="text-sm text-muted text-center py-12">Загрузка…</div>}
        </Card>
        <Card>
          <CardHeader title="Площадь по годам, м²" subtitle="Среднемесячно за год" />
          {yearlyChart
            ? <ChartWrap config={yearlyChart} height={320} />
            : <div className="text-sm text-muted text-center py-12">Загрузка…</div>}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Сводка по годам" subtitle="Средняя заполняемость и площади" />
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left  px-5 py-2 font-medium">Год</th>
                <th className="text-right px-5 py-2 font-medium">Месяцев</th>
                <th className="text-right px-5 py-2 font-medium">% сдано (комн.)</th>
                <th className="text-right px-5 py-2 font-medium">% сдано (м²)</th>
                <th className="text-right px-5 py-2 font-medium">Сдано м² (среднем.)</th>
                <th className="text-right px-5 py-2 font-medium">Свободно м²</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map(y => (
                <tr key={y.year} className="border-b border-border/50 hover:bg-surface2/50">
                  <td className="px-5 py-2 num font-semibold">{y.year}</td>
                  <td className="px-5 py-2 text-right num text-muted">{y.months}</td>
                  <td className={cn('px-5 py-2 text-right num font-semibold',
                    y.avgPct >= 85 ? 'text-good' : y.avgPct >= 70 ? 'text-warn' : 'text-bad')}>
                    {y.avgPct.toFixed(1)}%
                  </td>
                  <td className={cn('px-5 py-2 text-right num',
                    y.avgPctArea >= 85 ? 'text-good' : y.avgPctArea >= 70 ? 'text-warn' : 'text-bad')}>
                    {y.avgPctArea.toFixed(1)}%
                  </td>
                  <td className="px-5 py-2 text-right num">{Math.round(y.avgRentedArea)}</td>
                  <td className="px-5 py-2 text-right num text-bad">{Math.round(y.avgVacantArea)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ── Таб «Съезды и заезды» ─────────────────────────────────────────────
function MovementsTab() {
  const [years, setYears] = useState<YearMovement[]>([]);
  const [year, setYear]   = useState<number | null>(null);
  const [yearData, setYearData] = useState<{ monthly: MonthPoint[]; movements: Movement[] } | null>(null);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'arrival' | 'departure'>('all');

  useEffect(() => {
    fetch('/api/movements/summary').then(r => r.json()).then(d => {
      setYears(d.years);
      if (d.years.length && year === null) setYear(d.years[d.years.length - 1].year);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (year == null) return;
    setYearData(null);
    fetch(`/api/movements/year/${year}`).then(r => r.json()).then(setYearData).catch(() => {});
  }, [year]);

  const cur = useMemo(() => years.find(y => y.year === year) ?? null, [years, year]);
  const filtered = useMemo(() => {
    if (!yearData) return [];
    const q = filter.trim().toLowerCase();
    return yearData.movements.filter(m => {
      if (kindFilter !== 'all' && m.kind !== kindFilter) return false;
      if (!q) return true;
      return ((m.legalName ?? '').toLowerCase().includes(q) ||
              (m.tradeName ?? '').toLowerCase().includes(q) ||
              (m.room ?? '').toLowerCase().includes(q) ||
              (m.floor ?? '').toLowerCase().includes(q));
    });
  }, [yearData, filter, kindFilter]);

  const monthlyChart = useMemo(() => {
    if (!yearData?.monthly) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: yearData.monthly.map(p => MONTH_SHORT[p.month - 1]),
        datasets: [
          { label: 'Заезды',  data: yearData.monthly.map(p => p.arrivals),
            backgroundColor: '#34d399', borderRadius: 6, stack: 'a' },
          { label: 'Съезды', data: yearData.monthly.map(p => -p.departures),
            backgroundColor: '#f87171', borderRadius: 6, stack: 'a' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' as const },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number } }) =>
            `${c.dataset.label}: ${Math.abs(c.parsed.y)}` } },
        },
        scales: { x: { stacked: true },
                  y: { stacked: true,
                       ticks: { callback: (v: string | number) => Math.abs(Number(v)) } } },
      },
    };
  }, [yearData]);

  const yearsChart = useMemo(() => {
    if (years.length < 2) return null;
    return {
      type: 'line' as const,
      data: {
        labels: years.map(y => String(y.year)),
        datasets: [
          { label: 'Заезды', data: years.map(y => y.arrivals),
            borderColor: '#34d399', tension: 0.3, fill: false },
          { label: 'Съезды', data: years.map(y => y.departures),
            borderColor: '#f87171', tension: 0.3, fill: false },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' as const } },
        scales: { y: { beginAtZero: true } } },
    };
  }, [years]);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Calendar size={14} className="text-muted" />
        <span className="text-sm text-muted">Год:</span>
        {years.map(y => (
          <button
            key={y.year}
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

      {cur && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><Stat
            label="Заездов / съездов"
            value={<><span className="text-good">{cur.arrivals}</span> / <span className="text-bad">{cur.departures}</span></>}
            sub={<span className={cur.netCount >= 0 ? 'text-good' : 'text-bad'}>
              нетто: {cur.netCount >= 0 ? '+' : ''}{cur.netCount}</span>}
          /></Card>
          <Card><Stat
            label="Площадь нетто, м²"
            value={(cur.netAreaM2 >= 0 ? '+' : '') + Math.round(cur.netAreaM2)}
            sub={<>+{Math.round(cur.arrivalsAreaM2)} / −{Math.round(cur.departuresAreaM2)}</>}
            accent={cur.netAreaM2 >= 0 ? 'good' : 'bad'}
          /></Card>
          <Card><Stat
            label="Выручка нетто, ₽/мес"
            value={fmtShort(cur.netCharges)}
            sub={<>+{fmtShort(cur.arrivalsCharges)} / −{fmtShort(cur.departuresCharges)}</>}
            accent={cur.netCharges >= 0 ? 'good' : 'bad'}
          /></Card>
          <Card><Stat
            label="Всего событий"
            value={cur.arrivals + cur.departures}
            sub={`в реестре ${cur.year}`}
          /></Card>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader title="По месяцам" subtitle={`События ${cur?.year ?? ''}, заезды ↑ съезды ↓`} />
          {monthlyChart
            ? <ChartWrap config={monthlyChart} height={320} />
            : <div className="text-sm text-muted text-center py-12">Загрузка…</div>}
        </Card>
        <Card>
          <CardHeader title="Динамика по годам" subtitle="Заезды vs съезды" />
          {yearsChart
            ? <ChartWrap config={yearsChart} height={320} />
            : <div className="text-sm text-muted text-center py-12">Нужно ≥ 2 года</div>}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Реестр событий · ${cur?.year ?? ''}`}
          subtitle={`Показано ${fmtInt(filtered.length)} из ${fmtInt(yearData?.movements.length ?? 0)}`}
          right={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-surface2 border border-border rounded-lg">
                {(['all', 'arrival', 'departure'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(k)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium',
                      kindFilter === k
                        ? k === 'arrival'  ? 'bg-good/20 text-good'
                        : k === 'departure' ? 'bg-bad/20 text-bad'
                        : 'bg-accent/20 text-accent'
                        : 'text-muted hover:text-text',
                    )}>
                    {k === 'all' ? 'все' : k === 'arrival' ? 'заезды' : 'съезды'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input type="search" value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Бренд / юр. лицо / помещение"
                  className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-72" />
              </div>
            </div>
          } />
        {!yearData ? (
          <div className="text-sm text-muted text-center py-6">Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted text-center py-6">Ничего не найдено</div>
        ) : (
          <div className="overflow-x-auto -mx-5 max-h-[700px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left  px-5 py-2 font-medium">Тип</th>
                  <th className="text-left  px-5 py-2 font-medium">Дата</th>
                  <th className="text-left  px-5 py-2 font-medium">Этаж</th>
                  <th className="text-left  px-5 py-2 font-medium">Помещение</th>
                  <th className="text-right px-5 py-2 font-medium">м²</th>
                  <th className="text-left  px-5 py-2 font-medium">Юр.лицо</th>
                  <th className="text-left  px-5 py-2 font-medium">Бренд</th>
                  <th className="text-right px-5 py-2 font-medium">Начисления, ₽</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const isArr = m.kind === 'arrival';
                  return (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-surface2/50">
                      <td className="px-5 py-2">
                        <span className={cn(
                          'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold',
                          isArr ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad')}>
                          {isArr ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                          {isArr ? 'заезд' : 'съезд'}
                        </span>
                      </td>
                      <td className="px-5 py-2 num text-muted text-xs">
                        {m.eventDate ?? <span className="text-muted/60">{m.dateRaw ?? '—'}</span>}
                      </td>
                      <td className="px-5 py-2 text-muted">{m.floor ?? '—'}</td>
                      <td className="px-5 py-2 num">{m.room ?? '—'}</td>
                      <td className="px-5 py-2 text-right num text-muted">
                        {m.areaM2 != null ? m.areaM2.toFixed(1) : '—'}
                      </td>
                      <td className="px-5 py-2 truncate max-w-[280px]" title={m.legalName ?? ''}>
                        {m.legalName ?? '—'}
                      </td>
                      <td className="px-5 py-2 truncate max-w-[160px] text-muted text-xs"
                          title={m.tradeName ?? ''}>{m.tradeName ?? '—'}</td>
                      <td className="px-5 py-2 text-right num">
                        {m.chargesWithVat != null ? fmtRub(m.chargesWithVat) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Сводка по всем годам" />
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left  px-5 py-2 font-medium">Год</th>
                <th className="text-right px-5 py-2 font-medium">Заезды</th>
                <th className="text-right px-5 py-2 font-medium">Съезды</th>
                <th className="text-right px-5 py-2 font-medium">Нетто</th>
                <th className="text-right px-5 py-2 font-medium">Заняли, м²</th>
                <th className="text-right px-5 py-2 font-medium">Освобод., м²</th>
                <th className="text-right px-5 py-2 font-medium">Δ м²</th>
                <th className="text-right px-5 py-2 font-medium">Прирост ₽/мес</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => (
                <tr key={y.year} className="border-b border-border/50 hover:bg-surface2/50">
                  <td className="px-5 py-2 num font-semibold">
                    <button onClick={() => setYear(y.year)}
                      className={cn('hover:text-accent', year === y.year && 'text-accent')}>
                      {y.year}
                    </button>
                  </td>
                  <td className="px-5 py-2 text-right num text-good">+{y.arrivals}</td>
                  <td className="px-5 py-2 text-right num text-bad">−{y.departures}</td>
                  <td className={cn('px-5 py-2 text-right num font-semibold',
                    y.netCount > 0 ? 'text-good' : y.netCount < 0 ? 'text-bad' : 'text-muted')}>
                    {y.netCount >= 0 ? '+' : ''}{y.netCount}
                  </td>
                  <td className="px-5 py-2 text-right num text-muted">{Math.round(y.arrivalsAreaM2)}</td>
                  <td className="px-5 py-2 text-right num text-muted">{Math.round(y.departuresAreaM2)}</td>
                  <td className={cn('px-5 py-2 text-right num',
                    y.netAreaM2 > 0 ? 'text-good' : y.netAreaM2 < 0 ? 'text-bad' : 'text-muted')}>
                    {y.netAreaM2 >= 0 ? '+' : ''}{Math.round(y.netAreaM2)}
                  </td>
                  <td className={cn('px-5 py-2 text-right num',
                    y.netCharges > 0 ? 'text-good' : y.netCharges < 0 ? 'text-bad' : 'text-muted')}>
                    {y.netCharges >= 0 ? '+' : ''}{fmtShort(y.netCharges)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ── Таб «Помещения» (топ-долго-пустые + таймлайн) ──────────────────────
function RoomsTab() {
  const [vacant, setVacant]   = useState<VacantRoom[]>([]);
  const [filter, setFilter]   = useState('');
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [roomTimeline, setRoomTimeline] = useState<RoomMonth[]>([]);

  useEffect(() => {
    fetch('/api/occupancy/vacant').then(r => r.json())
      .then(d => setVacant(d.rooms)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRoom) { setRoomTimeline([]); return; }
    fetch(`/api/occupancy/room/${encodeURIComponent(selectedRoom)}`)
      .then(r => r.json()).then(d => setRoomTimeline(d.timeline)).catch(() => {});
  }, [selectedRoom]);

  const filteredVacant = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return vacant;
    return vacant.filter(v => v.room.toLowerCase().includes(q) ||
                              (v.floor ?? '').toLowerCase().includes(q));
  }, [filter, vacant]);

  const roomChart = useMemo(() => {
    if (!roomTimeline.length) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: roomTimeline.map(p => `${MONTH_SHORT[p.month - 1]} ${String(p.year).slice(2)}`),
        datasets: [{
          label: 'Статус',
          data: roomTimeline.map(p => p.status === 'rented' ? 1 : 0),
          backgroundColor: roomTimeline.map(p =>
            p.status === 'rented' ? '#34d399'
            : p.status === 'not_rented' ? '#f87171' : '#94a3b8'),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (c: { dataIndex: number }) => {
              const r = roomTimeline[c.dataIndex];
              return [
                r.status === 'rented' ? 'Сдан' : r.status === 'not_rented' ? 'Не сдан' : 'Другое',
                r.tradeName ?? r.legalName ?? '',
              ].filter(Boolean) as string[];
            },
          } },
        },
        scales: { y: { display: false, max: 1 } },
      },
    };
  }, [roomTimeline]);

  return (
    <>
      {selectedRoom && (
        <Card>
          <CardHeader
            title={`История помещения · ${selectedRoom}`}
            subtitle={`${roomTimeline.length} месячных снапшотов`}
            right={<button onClick={() => setSelectedRoom(null)}
              className="text-xs text-muted hover:text-accent">закрыть</button>}
          />
          {roomChart && <ChartWrap config={roomChart} height={120} />}
          <div className="overflow-x-auto -mx-5 mt-4 max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left  px-5 py-2 font-medium">Период</th>
                  <th className="text-left  px-5 py-2 font-medium">Статус</th>
                  <th className="text-left  px-5 py-2 font-medium">Юр.лицо</th>
                  <th className="text-left  px-5 py-2 font-medium">Бренд</th>
                  <th className="text-right px-5 py-2 font-medium">м²</th>
                </tr>
              </thead>
              <tbody>
                {roomTimeline.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-5 py-2 num">{MONTH_SHORT[r.month - 1]} {r.year}</td>
                    <td className="px-5 py-2">
                      <span className={cn(
                        'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold',
                        r.status === 'rented' ? 'bg-good/20 text-good'
                        : r.status === 'not_rented' ? 'bg-bad/20 text-bad'
                        : 'bg-surface2 text-muted')}>
                        {r.status === 'rented' ? 'сдан'
                          : r.status === 'not_rented' ? 'не сдан'
                          : (r.statusRaw ?? '—')}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-xs truncate max-w-[280px]">{r.legalName ?? '—'}</td>
                    <td className="px-5 py-2 text-xs text-muted">{r.tradeName ?? '—'}</td>
                    <td className="px-5 py-2 text-right num text-muted">
                      {r.areaM2 != null ? r.areaM2.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className={selectedRoom ? 'mt-6' : ''}>
        <CardHeader
          title="Топ-долго-пустые помещения"
          subtitle="Рейтинг по числу месяцев без арендатора · клик по строке — таймлайн"
          right={
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Помещение / этаж"
                className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-56" />
            </div>
          } />
        <div className="overflow-x-auto -mx-5 max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left  px-5 py-2 font-medium">Помещение</th>
                <th className="text-left  px-5 py-2 font-medium">Этаж</th>
                <th className="text-right px-5 py-2 font-medium">м² (сред.)</th>
                <th className="text-right px-5 py-2 font-medium">Месяцев пусто</th>
                <th className="text-right px-5 py-2 font-medium">Сдан</th>
                <th className="text-right px-5 py-2 font-medium">% пустых</th>
                <th className="text-left  px-5 py-2 font-medium">Последний раз пусто</th>
              </tr>
            </thead>
            <tbody>
              {filteredVacant.map(v => (
                <tr key={v.room}
                    onClick={() => setSelectedRoom(v.room)}
                    className={cn('border-b border-border/50 hover:bg-surface2/50 cursor-pointer',
                      selectedRoom === v.room && 'bg-accent/10')}>
                  <td className="px-5 py-2 num font-semibold">
                    <Building2 size={12} className="inline mr-1 text-muted" />
                    {v.room}
                  </td>
                  <td className="px-5 py-2 text-muted">{v.floor ?? '—'}</td>
                  <td className="px-5 py-2 text-right num text-muted">
                    {v.avgArea != null ? v.avgArea.toFixed(1) : '—'}
                  </td>
                  <td className="px-5 py-2 text-right num text-bad font-semibold">{v.vacantMonths}</td>
                  <td className="px-5 py-2 text-right num text-good">{v.rentedMonths}</td>
                  <td className={cn('px-5 py-2 text-right num font-semibold',
                    v.pctVacant >= 50 ? 'text-bad' : v.pctVacant >= 20 ? 'text-warn' : 'text-muted')}>
                    {v.pctVacant.toFixed(0)}%
                  </td>
                  <td className="px-5 py-2 num text-muted text-xs">{v.lastVacantPeriod ?? '—'}</td>
                </tr>
              ))}
              {filteredVacant.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted py-6">
                  {vacant.length === 0 ? 'Загрузка…' : 'Ничего не найдено'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-start gap-2 text-xs text-muted mt-4">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>
          В файле 2026 года есть лист «декабрь» без явного указания года —
          он попал как декабрь 2026, хотя по факту это декабрь 2025.
        </span>
      </div>
    </>
  );
}
