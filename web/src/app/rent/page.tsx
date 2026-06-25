'use client';

import { useEffect, useState, useMemo } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtRub, fmtPct, fmtShort, MONTH_NAMES_FULL, cn } from '@/lib/utils';
import {
  AlertTriangle, TrendingDown, TrendingUp, RefreshCw, ChevronDown,
  BarChart3, Receipt, Trophy, Users, MessageSquare, Check, Printer,
} from 'lucide-react';
import { printReport } from '@/lib/print';

type MonthSummary = {
  month: number; monthName: string; hasFact: boolean;
  planSTo: number | null; planBezTo: number | null;
  factSTo: number | null; factBezTo: number | null;
};

type LostRoomRow = {
  floor: string | null; room: string | null;
  lastLegal: string | null; lastTrade: string | null;
  area: number | null; monthlyPotential: number;
  monthsVacant: number; totalPotential: number;
};
type LostYearData = { totalYear: number; byMonth: Record<number, number>; byRoom: LostRoomRow[] };

type TabId = 'dashboard' | 'tenants' | 'discipline' | 'deviations' | 'log' | 'history' | 'lost';

const TABS: { id: TabId; label: string; Icon: any }[] = [
  { id: 'dashboard',  label: 'Дашборд',              Icon: BarChart3 },
  { id: 'tenants',    label: 'Арендаторы',           Icon: Users },
  { id: 'discipline', label: 'Платёжная дисциплина', Icon: Trophy },
  { id: 'deviations', label: 'Отклонения',           Icon: TrendingDown },
  { id: 'log',        label: 'История платежей',     Icon: Receipt },
  { id: 'history',    label: 'Платежи помесячно',    Icon: Receipt },
  { id: 'lost',       label: 'Недополучка',          Icon: AlertTriangle },
];

export default function RentPage() {
  const [summary, setSummary] = useState<{ months: MonthSummary[]; updatedAt: string; snapshotDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('dashboard');
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [refreshing, setRefreshing] = useState(false);
  const [lostYear, setLostYear] = useState<LostYearData | null>(null);

  async function loadSummary() {
    const r = await fetch('/api/rent/summary');
    if (!r.ok) { setError('Нет доступа к таблице'); return; }
    const data = await r.json();
    if (data.error) { setError(data.error); return; }
    setSummary(data);
    setError(null);
    const withFact = data.months.filter((m: MonthSummary) => m.hasFact);
    if (withFact.length) setMonth(withFact[withFact.length - 1].month);
  }

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { fetch('/api/rent/lost-revenue').then(r => r.json()).then(setLostYear).catch(() => {}); }, [summary?.snapshotDate]);

  async function refresh() {
    setRefreshing(true);
    await fetch('/api/rent/refresh', { method: 'POST' });
    await loadSummary();
    setRefreshing(false);
  }

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Аренда · 2026</h1>
            {summary && (
              <p className="text-sm text-muted mt-1">
                Снапшот: {summary.snapshotDate} · обновлено {new Date(summary.updatedAt.replace(' ', 'T')).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <button onClick={refresh} disabled={refreshing} className="btn-ghost">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Обновить
          </button>
        </div>

        {error && (
          <Card className="bg-bad/10 border-bad/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-bad mt-0.5" size={20} />
              <div>
                <div className="font-medium text-bad">Ошибка загрузки данных</div>
                <div className="text-sm text-muted mt-1">{error}</div>
              </div>
            </div>
          </Card>
        )}

        {/* Tab strip */}
        <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl overflow-x-auto">
          {TABS.map(({ id, label, Icon }) => (
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

        {tab === 'dashboard' && (
          <DashboardTab summary={summary} month={month} setMonth={setMonth}
                        lostYear={lostYear} />
        )}
        {tab === 'tenants' && (
          <TenantsTab summary={summary} month={month} setMonth={setMonth} />
        )}
        {tab === 'discipline' && <RatingTab />}
        {tab === 'deviations' && (
          <RoomsTab summary={summary} month={month} setMonth={setMonth} />
        )}
        {tab === 'log' && <ChangesTab />}
        {tab === 'history' && (
          <HistoryTab month={month} setMonth={setMonth} summary={summary} />
        )}
        {tab === 'lost' && (
          <LostTab month={month} setMonth={setMonth} summary={summary} />
        )}
      </main>
    </>
  );
}

// ─────────────────────────── Dashboard (Python layout) ────────────
const MONTH_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function DashboardTab({
  summary, month, setMonth, lostYear,
}: {
  summary: any; month: number; setMonth: (m: number) => void; lostYear: LostYearData | null;
}) {
  const cur: MonthSummary | undefined = summary?.months.find((m: MonthSummary) => m.month === month);

  // Cumulative: sum across all months that have hasFact AND are <= selected month.
  const cumulative = useMemo(() => {
    if (!summary) return null;
    const upto = summary.months.filter((m: MonthSummary) => m.hasFact && m.month <= month);
    const planSTo  = upto.reduce((s: number, m: MonthSummary) => s + (m.planSTo  ?? 0), 0);
    const factSTo  = upto.reduce((s: number, m: MonthSummary) => s + (m.factSTo  ?? 0), 0);
    const planBez  = upto.reduce((s: number, m: MonthSummary) => s + (m.planBezTo ?? 0), 0);
    const factBez  = upto.reduce((s: number, m: MonthSummary) => s + (m.factBezTo ?? 0), 0);
    const range = upto.length === 0 ? '' : upto.length === 1
      ? MONTH_NAMES_FULL[upto[0].month - 1]
      : `${MONTH_NAMES_FULL[upto[0].month - 1]} — ${MONTH_NAMES_FULL[upto[upto.length-1].month - 1]}`;
    return { planSTo, factSTo, planBez, factBez, range };
  }, [summary, month]);

  const chartConfig = useMemo(() => {
    if (!summary) return null;
    const labels = summary.months.map((m: MonthSummary) => MONTH_SHORT[m.month - 1]);
    return {
      type: 'bar' as const,
      data: {
        labels,
        datasets: [
          { label: 'План с ТО',
            data: summary.months.map((m: MonthSummary) => m.planSTo ?? 0),
            backgroundColor: 'rgba(96,165,250,0.55)', borderRadius: 6 },
          { label: 'Факт с ТО',
            data: summary.months.map((m: MonthSummary) => m.factSTo ?? 0),
            backgroundColor: '#3b82f6', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' as const, labels: { boxWidth: 12, padding: 16 } },
          tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${fmtRub(c.parsed.y)}` } },
        },
        scales: { y: { ticks: { callback: (v: any) => fmtShort(v) } } },
      },
    };
  }, [summary]);

  return (
    <>
      {/* Month picker — кнопочный ряд */}
      <Card>
        <div className="flex flex-wrap gap-2">
          {summary?.months.map((m: MonthSummary) => {
            const active = m.month === month;
            return (
              <button
                key={m.month}
                onClick={() => setMonth(m.month)}
                disabled={!m.hasFact}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  active   ? 'bg-accent/20 text-accent border border-accent/40'
                  : m.hasFact ? 'bg-surface2 border border-border text-text hover:border-accent/30'
                              : 'bg-surface2 border border-border/50 text-muted/50 cursor-not-allowed',
                )}
              >
                {MONTH_SHORT[m.month - 1]}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Per-month cards: с ТО + без ТО */}
      <div className="grid md:grid-cols-2 gap-4">
        <MonthMetricCard label="Арендная плата с ТО"  badge="с ТО"  badgeColor="#60a5fa"
                         plan={cur?.planSTo ?? null} fact={cur?.factSTo ?? null} />
        <MonthMetricCard label="Арендная плата без ТО" badge="без ТО" badgeColor="#34d399"
                         plan={cur?.planBezTo ?? null} fact={cur?.factBezTo ?? null} />
      </div>

      {/* Cumulative card */}
      {cumulative && (
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#60a5fa] via-accent to-[#34d399]" />
          <div className="pt-2">
            <CardHeader
              title={`Накопительно · ${cumulative.range || '—'}`}
              subtitle="Сумма по месяцам с фактом"
            />
            <CumulativeRow
              left={{ label: 'с ТО',  color: '#60a5fa', plan: cumulative.planSTo,  fact: cumulative.factSTo  }}
              right={{ label: 'без ТО', color: '#34d399', plan: cumulative.planBez, fact: cumulative.factBez }}
            />
            {lostYear && lostYear.totalYear > 0 && (
              <LostYearBreakdown data={lostYear} />
            )}
          </div>
        </Card>
      )}

      {/* Bar chart */}
      <Card>
        <CardHeader title="План vs Факт по месяцам" subtitle="Общая аренда с учётом ТО" />
        {chartConfig && <ChartWrap config={chartConfig} height={300} />}
      </Card>
    </>
  );
}

function MonthMetricCard({
  label, badge, badgeColor, plan, fact,
}: { label: string; badge: string; badgeColor: string; plan: number | null; fact: number | null }) {
  const pct = plan && plan > 0 ? Math.min(100, ((fact ?? 0) / plan) * 100) : 0;
  const pctRaw = plan && plan > 0 ? ((fact ?? 0) / plan) * 100 : 0;
  const delta = (fact ?? 0) - (plan ?? 0);
  const tone = pctRaw >= 95 ? 'good' : pctRaw >= 70 ? 'warn' : 'bad';
  const toneClass = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : 'text-bad';
  const toneFill  = tone === 'good' ? '#34d399'   : tone === 'warn' ? '#fbbf24'   : '#f87171';
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: badgeColor }} />
      <div className="pt-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">{label}</h3>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold"
                style={{ background: badgeColor + '25', color: badgeColor }}>{badge}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">План</div>
            <div className="text-lg sm:text-2xl font-bold num truncate">{fmtRub(plan)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted">Факт</div>
            <div className={cn('text-lg sm:text-2xl font-bold num truncate', toneClass)}>{fmtRub(fact)}</div>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: toneFill }} />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className={cn('font-semibold num', toneClass)}>{fmtPct(pctRaw, 1)}</span>
          <span className={cn('num', delta >= 0 ? 'text-good' : 'text-bad')}>
            {delta >= 0 ? '+' : ''}{fmtShort(delta)} к плану
          </span>
        </div>
      </div>
    </Card>
  );
}

function CumulativeRow({
  left, right,
}: {
  left:  { label: string; color: string; plan: number; fact: number };
  right: { label: string; color: string; plan: number; fact: number };
}) {
  const lPct = left.plan > 0 ? (left.fact / left.plan) * 100 : 0;
  const rPct = right.plan > 0 ? (right.fact / right.plan) * 100 : 0;
  const bigPct = (lPct + rPct) / 2;
  const bigCls = bigPct >= 95 ? 'text-good' : bigPct >= 70 ? 'text-warn' : 'text-bad';
  return (
    <div className="grid md:grid-cols-3 gap-6 items-center">
      <CumColumn side={left} />
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-muted">Выполнение</div>
        <div className={cn('text-5xl font-bold num leading-none mt-1', bigCls)}>{fmtPct(bigPct, 1)}</div>
        <div className="text-xs text-muted mt-2 num">среднее с ТО / без ТО</div>
      </div>
      <CumColumn side={right} alignRight />
    </div>
  );
}

function CumColumn({ side, alignRight }: { side: { label: string; color: string; plan: number; fact: number }; alignRight?: boolean }) {
  const pct = side.plan > 0 ? (side.fact / side.plan) * 100 : 0;
  const cls = pct >= 95 ? 'text-good' : pct >= 70 ? 'text-warn' : 'text-bad';
  return (
    <div className={cn(alignRight && 'md:text-right')}>
      <div className="flex items-center gap-2 mb-2" style={{ flexDirection: alignRight ? 'row-reverse' : undefined }}>
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
              style={{ background: side.color + '25', color: side.color }}>{side.label}</span>
        <span className={cn('text-xs num font-semibold', cls)}>{fmtPct(pct, 1)}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted">План</div>
      <div className="text-lg font-semibold num">{fmtRub(side.plan)}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted mt-2">Факт</div>
      <div className={cn('text-lg font-semibold num', cls)}>{fmtRub(side.fact)}</div>
    </div>
  );
}

// ─────────────────────────── Month picker ─────────────────────────
function MonthPicker({ month, setMonth, summary }: { month: number; setMonth: (m: number) => void; summary: any }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-muted">Месяц:</label>
      <div className="relative">
        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="appearance-none bg-surface2 border border-border rounded-lg pl-4 pr-10 py-2 text-sm font-medium focus:border-accent outline-none cursor-pointer"
        >
          {summary?.months.map((m: MonthSummary) => (
            <option key={m.month} value={m.month} disabled={!m.hasFact}>
              {m.monthName} {m.hasFact ? '' : '— нет данных'}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" size={16} />
      </div>
    </div>
  );
}

// ─────────────────────────── Tenants (directory + comments) ──────
type TenantRow = {
  trade: string; legal: string | null; floor: string | null; rooms: string | null;
  status: string | null; plan: number; fact: number; pct: number;
  comment: string | null; commentUpdatedAt: string | null;
};

function TenantsTab({ summary, month, setMonth }:
  { summary: any; month: number; setMonth: (m: number) => void }) {
  const [data, setData] = useState<{ items: TenantRow[]; totalPlan: number; totalFact: number; totalPct: number } | null>(null);
  const [filter, setFilter] = useState('');

  const load = () => {
    setData(null);
    fetch(`/api/rent/tenants?month=${month}`).then(r => r.json()).then(setData).catch(() => {});
  };
  useEffect(load, [month]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter(r =>
      (r.trade ?? '').toLowerCase().includes(q) ||
      (r.legal ?? '').toLowerCase().includes(q) ||
      (r.rooms ?? '').toLowerCase().includes(q) ||
      (r.floor ?? '').toLowerCase().includes(q),
    );
  }, [data, filter]);

  // Group by floor for visual grouping.
  const groups = useMemo(() => {
    const map = new Map<string, TenantRow[]>();
    for (const r of filtered) {
      const key = r.floor?.toString().trim() || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b, 'ru');
    });
  }, [filtered]);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker month={month} setMonth={setMonth} summary={summary} />
          <input
            type="search"
            placeholder="Поиск по бренду / юр.лицу / помещению…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-surface2 border border-border rounded-lg px-3 py-2 text-sm focus:border-accent outline-none flex-1 min-w-[200px]"
          />
          {data && (
            <div className="text-sm text-muted num">
              <span className="text-text font-semibold">{data.items.length}</span> арендаторов
              {' · '}
              <span className="text-text">{fmtRub(data.totalFact)}</span> / {fmtRub(data.totalPlan)}
              {' · '}
              <span className={cn('font-semibold',
                data.totalPct >= 95 ? 'text-good' : data.totalPct >= 70 ? 'text-warn' : 'text-bad')}>
                {fmtPct(data.totalPct, 1)}
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Арендаторы · ${MONTH_NAMES_FULL[month - 1]}`}
          subtitle="Список всех арендаторов с планом/фактом и заметками. Комментарий редактируется по клику."
        />
        {!data ? (
          <div className="text-sm text-muted py-6 text-center">Загрузка…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">Ничего не найдено</div>
        ) : (
          <>
            {/* Desktop / tablet: table */}
            <div className="hidden md:block overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                    <th className="text-left  px-5 py-2 font-medium">Этаж</th>
                    <th className="text-left  px-5 py-2 font-medium">Арендатор</th>
                    <th className="text-left  px-5 py-2 font-medium">Помещение</th>
                    <th className="text-right px-5 py-2 font-medium">План</th>
                    <th className="text-right px-5 py-2 font-medium">Факт</th>
                    <th className="text-right px-5 py-2 font-medium">%</th>
                    <th className="text-left  px-5 py-2 font-medium min-w-[260px]">Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([floor, rows]) => (
                    <FragmentBlock key={floor} floor={floor} rows={rows} onSaved={load} />
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile: card list */}
            <div className="md:hidden space-y-4 -mx-2">
              {groups.map(([floor, rows]) => (
                <div key={floor}>
                  <div className="text-[11px] uppercase tracking-wider text-muted font-semibold px-2 py-1 mb-1">
                    {floor === '—' ? 'без этажа' : `${floor} этаж`} · {rows.length}
                  </div>
                  <div className="space-y-2">
                    {rows.map(r => <TenantCardItem key={r.trade} row={r} onSaved={load} />)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function FragmentBlock({ floor, rows, onSaved }: { floor: string; rows: TenantRow[]; onSaved: () => void }) {
  return (
    <>
      <tr className="bg-surface2/40">
        <td colSpan={7} className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-muted font-semibold border-y border-border">
          {floor === '—' ? 'без этажа' : `${floor} этаж`} · {rows.length}
        </td>
      </tr>
      {rows.map(r => <TenantRowItem key={r.trade} row={r} onSaved={onSaved} />)}
    </>
  );
}

function TenantRowItem({ row, onSaved }: { row: TenantRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.comment ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(row.comment ?? ''); }, [row.comment]);

  const debt = row.plan - row.fact;
  const save = async () => {
    if (draft === (row.comment ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/rent/tenants/comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trade: row.trade, comment: draft }),
      });
      if (res.ok) { setEditing(false); onSaved(); }
    } finally { setSaving(false); }
  };

  return (
    <tr className="border-b border-border/50 hover:bg-surface2/50 align-top">
      <td className="px-5 py-2.5 text-muted num text-xs">{row.floor ?? '—'}</td>
      <td className="px-5 py-2.5">
        <div className="font-medium truncate max-w-[260px]">{row.trade}</div>
        {row.legal && <div className="text-xs text-muted truncate max-w-[260px]">{row.legal}</div>}
      </td>
      <td className="px-5 py-2.5 text-muted text-xs">{row.rooms}</td>
      <td className="px-5 py-2.5 text-right num text-muted">{fmtShort(row.plan)}</td>
      <td className="px-5 py-2.5 text-right num">{fmtShort(row.fact)}</td>
      <td className={cn('px-5 py-2.5 text-right num font-semibold',
        row.pct >= 100 ? 'text-good' : row.pct >= 50 ? 'text-warn' : row.pct > 0 ? 'text-bad' : 'text-muted')}>
        {fmtPct(row.pct, 0)}
        {debt > 0 && <div className="text-[10px] text-bad/80 num font-normal">долг {fmtShort(debt)}</div>}
      </td>
      <td className="px-5 py-2.5">
        {editing ? (
          <div className="flex items-start gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
              rows={2}
              className="flex-1 bg-surface2 border border-accent/50 rounded-md px-2 py-1 text-sm text-text resize-y min-h-[44px] focus:outline-none focus:border-accent"
              placeholder="Заметка по арендатору…"
              onKeyDown={e => {
                if (e.key === 'Escape') { setDraft(row.comment ?? ''); setEditing(false); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              }}
            />
            <button
              onClick={save}
              disabled={saving}
              className="shrink-0 bg-accent/20 border border-accent/40 text-accent rounded-md p-1.5 hover:bg-accent/30 disabled:opacity-50"
              title="Сохранить (Ctrl+Enter)"
            >
              <Check size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={cn(
              'w-full text-left text-xs rounded-md px-2 py-1.5 transition-colors',
              row.comment
                ? 'bg-surface2 hover:bg-surface2/80 text-text'
                : 'text-muted/60 hover:text-muted hover:bg-surface2/50 italic',
            )}
            title="Редактировать"
          >
            <div className="flex items-start gap-2">
              <MessageSquare size={12} className="mt-0.5 shrink-0 opacity-60" />
              <div className="flex-1 whitespace-pre-wrap break-words">
                {row.comment || 'добавить заметку'}
              </div>
            </div>
            {row.commentUpdatedAt && (
              <div className="text-[10px] text-muted/60 mt-0.5 num pl-5">{row.commentUpdatedAt}</div>
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

function TenantCardItem({ row, onSaved }: { row: TenantRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.comment ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(row.comment ?? ''); }, [row.comment]);

  const debt = row.plan - row.fact;
  const save = async () => {
    if (draft === (row.comment ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/rent/tenants/comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trade: row.trade, comment: draft }),
      });
      if (res.ok) { setEditing(false); onSaved(); }
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-surface2/40 border border-border/60 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{row.trade}</div>
          {row.legal && <div className="text-xs text-muted truncate">{row.legal}</div>}
          <div className="text-[11px] text-muted mt-0.5">
            {row.rooms} {row.floor && <>· {row.floor} эт.</>}
          </div>
        </div>
        <div className={cn('text-right shrink-0',
          row.pct >= 100 ? 'text-good' : row.pct >= 50 ? 'text-warn' : row.pct > 0 ? 'text-bad' : 'text-muted')}>
          <div className="text-lg font-bold num">{fmtPct(row.pct, 0)}</div>
          {debt > 0 && <div className="text-[10px] text-bad/80 num">долг {fmtShort(debt)}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-surface/50 rounded px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase tracking-wider">План</div>
          <div className="num font-semibold">{fmtShort(row.plan)}</div>
        </div>
        <div className="bg-surface/50 rounded px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase tracking-wider">Факт</div>
          <div className="num font-semibold">{fmtShort(row.fact)}</div>
        </div>
      </div>
      {editing ? (
        <div className="flex items-start gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            rows={2}
            className="flex-1 bg-surface border border-accent/50 rounded-md px-2 py-1.5 text-sm resize-y min-h-[44px] focus:outline-none focus:border-accent"
            placeholder="Заметка по арендатору…"
            onKeyDown={e => {
              if (e.key === 'Escape') { setDraft(row.comment ?? ''); setEditing(false); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
          />
          <button
            onClick={save}
            disabled={saving}
            className="shrink-0 bg-accent/20 border border-accent/40 text-accent rounded-md p-2 hover:bg-accent/30 disabled:opacity-50"
            title="Сохранить"
          >
            <Check size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={cn(
            'w-full text-left text-xs rounded-md px-2.5 py-2 transition-colors min-h-[44px] flex items-start gap-2',
            row.comment
              ? 'bg-surface text-text'
              : 'text-muted/70 italic bg-surface/50',
          )}
        >
          <MessageSquare size={14} className="mt-0.5 shrink-0 opacity-60" />
          <div className="flex-1 whitespace-pre-wrap break-words">
            {row.comment || 'добавить заметку'}
          </div>
        </button>
      )}
    </div>
  );
}

// ─────────────────────────── Rooms (deviations) ───────────────────
function RoomsTab({ summary, month, setMonth }: { summary: any; month: number; setMonth: (m: number) => void }) {
  const [devs, setDevs] = useState<any>(null);
  useEffect(() => {
    setDevs(null);
    fetch(`/api/rent/deviations?month=${month}`).then(r => r.json()).then(setDevs).catch(() => {});
  }, [month]);
  const currentMonth = summary?.months.find((m: MonthSummary) => m.month === month);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <MonthPicker month={month} setMonth={setMonth} summary={summary} />
          {currentMonth?.hasFact && (
            <div className="text-sm text-muted num">
              План: <span className="text-text font-semibold">{fmtRub(currentMonth.planSTo)}</span>
              {'  ·  '}
              Факт: <span className="text-text font-semibold">{fmtRub(currentMonth.factSTo)}</span>
              {'  ·  '}
              Выполнение:{' '}
              <span className={cn('font-semibold',
                currentMonth.planSTo && currentMonth.factSTo
                  ? (currentMonth.factSTo / currentMonth.planSTo) >= 0.95 ? 'text-good' : 'text-warn' : '',
              )}>
                {fmtPct(currentMonth.planSTo ? (currentMonth.factSTo ?? 0) / currentMonth.planSTo * 100 : 0)}
              </span>
            </div>
          )}
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Платят по плану или больше" subtitle={`${devs?.above?.length ?? 0} арендаторов`}
                      right={<TrendingUp className="text-good" size={20} />} />
          <DevTable rows={devs?.above ?? []} good />
        </Card>
        <Card>
          <CardHeader title="Недоплачивают / не платили" subtitle={`${devs?.below?.length ?? 0} арендаторов`}
                      right={<TrendingDown className="text-bad" size={20} />} />
          <DevTable rows={devs?.below ?? []} />
        </Card>
      </div>
    </>
  );
}

function DevTable({ rows, good }: { rows: any[]; good?: boolean }) {
  if (rows.length === 0) return <div className="text-sm text-muted py-6 text-center">Нет данных</div>;
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
            <th className="text-left px-5 py-2 font-medium">Юр.Лицо</th>
            <th className="text-right px-5 py-2 font-medium">План</th>
            <th className="text-right px-5 py-2 font-medium">Факт</th>
            <th className="text-right px-5 py-2 font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
              <td className="px-5 py-2.5">
                <div className="font-medium truncate max-w-[320px]">{r.name}</div>
                {r.trade && r.trade !== r.name && (
                  <div className="text-xs text-muted truncate max-w-[320px]">{r.trade} · {r.room}</div>
                )}
              </td>
              <td className="px-5 py-2.5 text-right num text-muted">{fmtShort(r.plan)}</td>
              <td className="px-5 py-2.5 text-right num">{fmtShort(r.fact)}</td>
              <td className={cn('px-5 py-2.5 text-right num font-semibold',
                good ? 'text-good' : r.pct >= 50 ? 'text-warn' : 'text-bad')}>
                {fmtPct(r.pct, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <div className="text-center text-xs text-muted py-3">Показано 20 из {rows.length}</div>
      )}
    </div>
  );
}

// ───────────── Расшифровка годовой недополучки (суммарно по помещениям) ────
function LostYearBreakdown({ data }: { data: LostYearData }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rooms = data.byRoom ?? [];
  const shown = showAll ? rooms : rooms.slice(0, 8);

  return (
    <div className="mt-5 pt-4 border-t border-border/60">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm w-full text-left group"
      >
        <ChevronDown size={15} className={cn('text-muted transition-transform', open && 'rotate-180')} />
        <span className="text-muted">Недополученная выгода за год:</span>
        <span className="font-semibold text-bad num">{fmtRub(data.totalYear)}</span>
        <span className="text-xs text-muted ml-auto group-hover:text-text transition-colors">
          {rooms.length} помещ. · {open ? 'свернуть' : 'расшифровка'}
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="text-xs text-muted mb-3">
            Помещения, которые сдавались в декабре 2025, но сейчас «Не сдан».
            Суммарный потенциал аренды (с НДС) за всё время простоя — по убыванию.
          </div>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left  px-5 py-2 font-medium">Помещение</th>
                  <th className="text-left  px-5 py-2 font-medium">Последний арендатор (дек. 25)</th>
                  <th className="text-right px-5 py-2 font-medium">Пл., м²</th>
                  <th className="text-right px-5 py-2 font-medium">Мес. простоя</th>
                  <th className="text-right px-5 py-2 font-medium">₽/мес</th>
                  <th className="text-right px-5 py-2 font-medium">Σ за год</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface2/50 transition-colors">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <span className="font-medium">{r.room || '—'}</span>
                      {r.floor && <span className="text-xs text-muted ml-2">эт. {r.floor}</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium truncate max-w-[280px]">{r.lastTrade || r.lastLegal || '—'}</div>
                      {r.lastLegal && r.lastTrade && (
                        <div className="text-xs text-muted truncate max-w-[280px]">{r.lastLegal}</div>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right num text-muted">{r.area ? r.area.toFixed(1) : '—'}</td>
                    <td className="px-5 py-2.5 text-right num text-muted">{r.monthsVacant}</td>
                    <td className="px-5 py-2.5 text-right num text-muted">{fmtShort(r.monthlyPotential)}</td>
                    <td className="px-5 py-2.5 text-right num font-semibold text-bad">{fmtRub(r.totalPotential)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td className="px-5 py-2.5 text-xs text-muted uppercase tracking-wider" colSpan={5}>Итого</td>
                  <td className="px-5 py-2.5 text-right num font-bold text-bad">{fmtRub(data.totalYear)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {rooms.length > 8 && (
            <button onClick={() => setShowAll(v => !v)} className="mt-3 text-xs text-accent hover:underline">
              {showAll ? 'Свернуть' : `Показать все (${rooms.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Lost revenue ─────────────────────────
function LostTab({ month, setMonth, summary }: { month: number; setMonth: (m: number) => void; summary: any }) {
  const [lost, setLost] = useState<any>(null);
  useEffect(() => {
    setLost(null);
    fetch(`/api/rent/lost-revenue?month=${month}`).then(r => r.json()).then(setLost).catch(() => {});
  }, [month]);

  function printLost() {
    if (!lost || !lost.items.length) return;
    printReport({
      title: `Недополученная выгода · ${MONTH_NAMES_FULL[month - 1]} 2026`,
      meta: [
        'Помещения «Не сдан», которые сдавались в декабре 2025',
        `Итого за месяц: ${fmtRub(lost.total)} · ${lost.items.length} помещений`,
      ],
      columns: [
        { label: 'Этаж', align: 'left' }, { label: 'Помещение', align: 'left' },
        { label: 'Пл., м²', align: 'right' }, { label: 'Последний арендатор (дек. 25)', align: 'left' },
        { label: 'Потенциал, ₽/мес', align: 'right' },
      ],
      rows: lost.items.map((it: any) => [
        it.floor ?? '—', it.room ?? '—', it.area ? it.area.toFixed(1) : '—',
        it.lastTrade || it.lastLegal || '—',
        { text: fmtRub(it.potentialRevenue), color: '#b91c1c' },
      ]),
    });
  }

  return (
    <>
      <Card>
        <MonthPicker month={month} setMonth={setMonth} summary={summary} />
      </Card>
      <Card className="border-bad/30">
        <CardHeader
          title="Недополученная выгода"
          subtitle={`Помещения «Не сдан» в ${MONTH_NAMES_FULL[month - 1]} 2026, которые сдавались в декабре 2025`}
          right={
            <div className="flex items-center gap-3">
              {lost && lost.items.length > 0 && (
                <button onClick={printLost}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface2 border border-border text-text hover:border-accent/40">
                  <Printer size={14} /> Печать
                </button>
              )}
              <div className="text-right">
                <div className="text-xs text-muted">Итого за месяц</div>
                <div className="text-xl font-bold text-bad num">{fmtRub(lost?.total ?? null)}</div>
              </div>
            </div>
          }
        />
        {!lost ? (
          <div className="text-sm text-muted py-6 text-center">Загрузка…</div>
        ) : lost.items.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">Все помещения сданы — потерянной выгоды нет</div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left px-5 py-2 font-medium">Этаж</th>
                  <th className="text-left px-5 py-2 font-medium">Помещение</th>
                  <th className="text-left px-5 py-2 font-medium">Пл., м²</th>
                  <th className="text-left px-5 py-2 font-medium">Последний арендатор (дек. 25)</th>
                  <th className="text-right px-5 py-2 font-medium">Потенциал, ₽/мес</th>
                </tr>
              </thead>
              <tbody>
                {lost.items.map((it: any, i: number) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface2/50 transition-colors">
                    <td className="px-5 py-3 text-muted">{it.floor}</td>
                    <td className="px-5 py-3 font-medium">{it.room}</td>
                    <td className="px-5 py-3 num text-muted">{it.area ? it.area.toFixed(1) : '—'}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium">{it.lastTrade || it.lastLegal}</div>
                      {it.lastLegal && it.lastTrade && (
                        <div className="text-xs text-muted truncate max-w-[400px]">{it.lastLegal}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right num font-semibold text-bad">{fmtRub(it.potentialRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ─────────────────────────── Payment history ──────────────────────
function HistoryTab({ month, setMonth, summary }: { month: number; setMonth: (m: number) => void; summary: any }) {
  const [hist, setHist] = useState<any>(null);
  useEffect(() => {
    setHist(null);
    fetch(`/api/rent/history?month=${month}`).then(r => r.json()).then(setHist).catch(() => {});
  }, [month]);

  function printHistory() {
    if (!hist) return;
    const rows = hist.items.map((r: any) => {
      const debt = r.planVat - r.factOplat;
      return [
        r.trade || r.legal || '—', r.room ?? '—',
        fmtRub(r.planVat), fmtRub(r.factOplat),
        { text: fmtPct(r.pct, 0), color: r.pct >= 100 ? '#15803d' : r.pct >= 50 ? '#a16207' : '#b91c1c' },
        debt > 0 ? { text: fmtRub(debt), color: '#b91c1c' } : '—',
      ];
    });
    printReport({
      title: `История платежей · ${MONTH_NAMES_FULL[month - 1]} 2026`,
      meta: [
        `Итого оплачено: ${fmtRub(hist.totalFact)} из ${fmtRub(hist.totalPlan)} (${fmtPct(hist.totalPct, 1)})`,
        `${hist.items.length} арендаторов · статус «Сдан», план > 0`,
      ],
      columns: [
        { label: 'Арендатор', align: 'left' }, { label: 'Помещение', align: 'left' },
        { label: 'План', align: 'right' }, { label: 'Оплачено', align: 'right' },
        { label: '%', align: 'right' }, { label: 'Долг', align: 'right' },
      ],
      rows,
    });
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <MonthPicker month={month} setMonth={setMonth} summary={summary} />
          {hist && (
            <div className="text-sm text-muted num">
              Итого: <span className="text-text font-semibold">{fmtRub(hist.totalFact)}</span>
              <span className="text-muted"> / {fmtRub(hist.totalPlan)}</span>
              {'  ·  '}
              <span className={cn('font-semibold',
                hist.totalPct >= 95 ? 'text-good' : hist.totalPct >= 70 ? 'text-warn' : 'text-bad')}>
                {fmtPct(hist.totalPct, 1)}
              </span>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader
          title={`История платежей · ${MONTH_NAMES_FULL[month - 1]}`}
          subtitle="По Юр.Лицам (статус «Сдан» с планом > 0)"
          right={hist && hist.items.length > 0 && (
            <button onClick={printHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface2 border border-border text-text hover:border-accent/40">
              <Printer size={14} /> Печать
            </button>
          )}
        />
        {!hist ? (
          <div className="text-sm text-muted py-6 text-center">Загрузка…</div>
        ) : hist.items.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">Нет данных</div>
        ) : (
          <div className="overflow-x-auto -mx-5 max-h-[700px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left  px-5 py-2 font-medium">Арендатор</th>
                  <th className="text-left  px-5 py-2 font-medium">Помещение</th>
                  <th className="text-right px-5 py-2 font-medium">План</th>
                  <th className="text-right px-5 py-2 font-medium">Оплачено</th>
                  <th className="text-right px-5 py-2 font-medium">%</th>
                  <th className="text-right px-5 py-2 font-medium">Долг</th>
                </tr>
              </thead>
              <tbody>
                {hist.items.map((r: any, i: number) => {
                  const debt = r.planVat - r.factOplat;
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
                      <td className="px-5 py-2.5">
                        <div className="font-medium truncate max-w-[320px]">{r.trade || r.legal}</div>
                        {r.legal && r.trade && <div className="text-xs text-muted truncate max-w-[320px]">{r.legal}</div>}
                      </td>
                      <td className="px-5 py-2.5 text-muted num">{r.room}</td>
                      <td className="px-5 py-2.5 text-right num text-muted">{fmtShort(r.planVat)}</td>
                      <td className="px-5 py-2.5 text-right num">{fmtShort(r.factOplat)}</td>
                      <td className={cn('px-5 py-2.5 text-right num font-semibold',
                        r.pct >= 100 ? 'text-good' : r.pct >= 50 ? 'text-warn' : 'text-bad')}>
                        {fmtPct(r.pct, 0)}
                      </td>
                      <td className={cn('px-5 py-2.5 text-right num',
                        debt <= 0 ? 'text-muted' : 'text-bad font-semibold')}>
                        {debt > 0 ? fmtShort(debt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ─────────────────────────── Changes feed (payment log) ───────────
function ChangesTab() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch('/api/rent/changes').then(r => r.json()).then(setData).catch(() => {}); }, []);

  return (
    <Card>
      <CardHeader
        title="Изменения · журнал платежей"
        subtitle="Каждый раз, когда меняется сумма «Оплачено АП» по арендатору — фиксируем"
      />
      {!data ? (
        <div className="text-sm text-muted py-6 text-center">Загрузка…</div>
      ) : data.changes.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">Изменений пока нет</div>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left px-5 py-2 font-medium">Когда</th>
                <th className="text-left px-5 py-2 font-medium">Месяц</th>
                <th className="text-left px-5 py-2 font-medium">Юр.лицо</th>
                <th className="text-right px-5 py-2 font-medium">Было</th>
                <th className="text-right px-5 py-2 font-medium">Стало</th>
                <th className="text-right px-5 py-2 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.changes.map((c: any, i: number) => {
                const delta = Number(c.delta ?? 0);
                const dCls = delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-muted';
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
                    <td className="px-5 py-2.5 text-muted num">{c.detectedAt}</td>
                    <td className="px-5 py-2.5 text-muted">{c.monthName ?? MONTH_NAMES_FULL[c.monthNum - 1]}</td>
                    <td className="px-5 py-2.5">{c.legal}</td>
                    <td className="px-5 py-2.5 text-right text-muted num">{c.oldValue == null ? '—' : fmtRub(c.oldValue)}</td>
                    <td className="px-5 py-2.5 text-right num">{c.newValue == null ? '—' : fmtRub(c.newValue)}</td>
                    <td className={cn('px-5 py-2.5 text-right num font-semibold', dCls)}>
                      {delta > 0 ? '+' : ''}{fmtRub(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────── Платёжная дисциплина (Python layout) ─
function RatingTab() {
  const [disc, setDisc] = useState<any>(null);
  useEffect(() => { fetch('/api/rent/discipline').then(r => r.json()).then(setDisc).catch(() => {}); }, []);

  const stable   = disc?.stable   ?? [];
  const unstable = disc?.unstable ?? [];
  const total = stable.length + unstable.length;
  const stablePaid   = stable.reduce  ((s: number, r: any) => s + (r.fact ?? 0), 0);
  const unstablePaid = unstable.reduce((s: number, r: any) => s + (r.fact ?? 0), 0);
  const unstableDebt = unstable.reduce((s: number, r: any) => s + (r.debt ?? 0), 0);
  const stablePct   = total > 0 ? (stable.length   / total) * 100 : 0;
  const unstablePct = total > 0 ? (unstable.length / total) * 100 : 0;

  return (
    <>
      {/* Top summary: 2 big counters */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-good" />
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">Стабильные</h3>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold bg-good/20 text-good">
                Платят во всех {disc?.months?.length ?? 0} мес.
              </span>
            </div>
            <div className="flex items-end gap-4 mb-2">
              <div className="text-5xl font-bold text-good num leading-none">{stable.length}</div>
              <div className="text-2xl text-muted num pb-1">{fmtPct(stablePct, 0)}</div>
            </div>
            <div className="text-xs text-muted">
              Оплатили: <span className="text-text font-semibold num">{fmtRub(stablePaid)}</span>
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-warn" />
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">Нестабильные</h3>
              {disc?.inProgress?.length > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold bg-warn/20 text-warn">
                  В процессе: {disc.inProgress.map((m: number) => MONTH_SHORT[m - 1]).join(', ')}
                </span>
              )}
            </div>
            <div className="flex items-end gap-4 mb-2">
              <div className="text-5xl font-bold text-warn num leading-none">{unstable.length}</div>
              <div className="text-2xl text-muted num pb-1">{fmtPct(unstablePct, 0)}</div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted">Оплатили: <span className="text-text font-semibold num">{fmtRub(unstablePaid)}</span></span>
              <span className="text-muted">Недоплата: <span className="text-bad font-semibold num">{fmtRub(unstableDebt)}</span></span>
            </div>
          </div>
        </Card>
      </div>

      {/* Помесячная шкала дисциплины */}
      <DisciplineStrips stable={stable} unstable={unstable} />

      {/* Tables */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Стабильно платят"
            subtitle={`Платили во всех ${disc?.months?.length ?? 0} учтённых месяцах · ${stable.length} арендаторов`}
          />
          <RatingTable rows={stable} mode="stable" />
        </Card>
        <Card>
          <CardHeader
            title="Проблемные плательщики"
            subtitle={`Пропускали оплаты · ${unstable.length} арендаторов`}
          />
          <RatingTable rows={unstable} mode="unstable" />
        </Card>
      </div>
    </>
  );
}

// Помесячная шкала оплаты: по каждому арендатору 12 отрезков-месяцев.
// 🟢 закрыл по плану · 🟡 не по плану · 🔴 не закрыл · 🟠 скидка (задел).
const PAY_COLOR: Record<string, string> = {
  green: '#22c55e', yellow: '#eab308', red: '#ef4444', orange: '#fb923c',
};
function DisciplineStrips({ stable, unstable }: { stable: any[]; unstable: any[] }) {
  const [q, setQ] = useState('');
  const all = [...unstable, ...stable];        // сначала проблемные, потом стабильные
  const rows = all.filter(r => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (r.trade ?? '').toLowerCase().includes(s) || (r.legal ?? '').toLowerCase().includes(s);
  });
  const legend = (
    <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
      {([['green', 'по плану'], ['yellow', 'не по плану'], ['red', 'не закрыл'], ['orange', 'скидка (скоро)']] as const).map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: PAY_COLOR[k] }} /> {l}
        </span>
      ))}
    </div>
  );
  return (
    <Card>
      <CardHeader
        title="Платёжная дисциплина по месяцам"
        subtitle="Каждый отрезок — месяц. Наведи на ячейку — план и факт."
        right={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {legend}
            <div className="relative">
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Арендатор"
                className="bg-surface2 border border-border rounded-lg px-3 py-1.5 text-sm focus:border-accent outline-none w-44" />
            </div>
          </div>
        }
      />
      <div className="overflow-x-auto -mx-5">
        <div className="min-w-[680px]">
          {/* шапка с месяцами */}
          <div className="flex items-center px-5 py-1 text-[10px] text-muted uppercase tracking-wider border-b border-border sticky top-0 bg-surface z-10">
            <div className="w-[240px] shrink-0">Арендатор</div>
            <div className="flex-1 flex gap-0.5">
              {MONTH_SHORT.map((mn, i) => <div key={i} className="flex-1 text-center">{mn}</div>)}
            </div>
            <div className="w-14 text-right">Платежи</div>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {rows.map((r, idx) => {
              const cellByMonth = new Map<number, any>();
              for (const c of (r.cells ?? [])) cellByMonth.set(c.m, c);
              return (
                <div key={idx} className="flex items-center px-5 py-1.5 border-b border-border/30 hover:bg-surface2/40">
                  <div className="w-[240px] shrink-0 pr-2">
                    <div className="text-sm font-medium truncate">{r.trade || r.legal}</div>
                    {r.room && <div className="text-[10px] text-muted truncate">{r.room}</div>}
                  </div>
                  <div className="flex-1 flex gap-0.5">
                    {Array.from({ length: 12 }, (_, i) => {
                      const m = i + 1;
                      const c = cellByMonth.get(m);
                      const bg = c ? PAY_COLOR[c.status] : 'rgba(148,163,184,0.12)';
                      const title = c
                        ? `${MONTH_SHORT[i]}: план ${fmtShort(c.plan)} ₽, факт ${fmtShort(c.fact)} ₽`
                        : `${MONTH_SHORT[i]}: нет данных`;
                      return <div key={i} title={title} className="flex-1 h-6 rounded-sm" style={{ background: bg }} />;
                    })}
                  </div>
                  <div className={cn('w-14 text-right text-xs num font-semibold',
                    r.paid === r.total ? 'text-good' : r.pct < 50 ? 'text-bad' : 'text-warn')}>
                    {r.paid}/{r.total}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="text-sm text-muted py-6 text-center">Нет данных</div>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function RatingTable({ rows, mode }: { rows: any[]; mode: 'stable' | 'unstable' }) {
  if (rows.length === 0) return <div className="text-sm text-muted py-6 text-center">Нет данных</div>;
  return (
    <div className="overflow-x-auto -mx-5 max-h-[600px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface z-10">
          <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
            <th className="text-left px-5 py-2 font-medium">Арендатор</th>
            <th className="text-right px-5 py-2 font-medium">Платили</th>
            {mode === 'unstable' && <th className="text-right px-5 py-2 font-medium">Долг</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
              <td className="px-5 py-2.5">
                <div className="font-medium truncate max-w-[320px]">{r.trade || r.legal}</div>
                {r.legal && r.trade && <div className="text-xs text-muted truncate max-w-[320px]">{r.legal} · {r.room}</div>}
              </td>
              <td className="px-5 py-2.5 text-right num">
                <span className={mode === 'stable' ? 'text-good font-semibold' : r.pct < 50 ? 'text-bad' : 'text-warn'}>
                  {r.paid}/{r.total}
                </span>
                <div className="text-xs text-muted">{fmtPct(r.pct, 0)}</div>
              </td>
              {mode === 'unstable' && (
                <td className="px-5 py-2.5 text-right num font-semibold text-bad">
                  {fmtShort(r.debt)}
                  {r.streak > 1 && <div className="text-xs text-bad/70">{r.streak} мес. подряд</div>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
