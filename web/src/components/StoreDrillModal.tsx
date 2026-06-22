'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartWrap } from '@/components/Chart';
import { fmtShort, fmtInt, fmtPct, cn } from '@/lib/utils';
import { printReport, type PrintCell } from '@/lib/print';
import { X, Printer } from 'lucide-react';

const MONTH_NAMES_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

type StoreMonthlyTimelinePoint = {
  year: number; month: number;
  toSum: number | null; toPerM2: number | null;
  yoyPct: number | null; momPct: number | null;
  purchases: number | null; ap: number | null;
};
type StoreFocusPoint = {
  year: number; month: number;
  avgCheck: number | null; receipts: number | null;
  salesPerM2: number | null; returns: number | null;
};

// Карточка магазина: помесячная история (ТО, ТО/м², YoY/MoM, покупки,
// средний чек/чеки из Focus, АП) + график + печать. Данные грузит сама по
// названию магазина — используется и в сезонной карте ТО, и на карте этажей.
export function StoreDrillModal({ store, onClose }: { store: string; onClose: () => void }) {
  const [data, setData] = useState<StoreMonthlyTimelinePoint[] | null>(null);
  const [focus, setFocus] = useState<StoreFocusPoint[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setFocus(null);
    fetch(`/api/turnover/store/${encodeURIComponent(store)}/monthly`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d.monthly ?? []); setFocus(d.focus ?? []); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [store]);

  const focusMap = useMemo(() => {
    const m = new Map<string, StoreFocusPoint>();
    for (const f of focus ?? []) m.set(`${f.year}-${f.month}`, f);
    return m;
  }, [focus]);
  const hasFocus = (focus ?? []).length > 0;
  const lastFocus = useMemo(() => {
    const arr = (focus ?? []).filter(f => f.receipts != null || f.avgCheck != null);
    return arr.length ? arr[arr.length - 1] : null;
  }, [focus]);

  // YoY/MoM считаем сами из ряда to_sum (хранимые из Excel битые). Берём
  // только месяцы с to_sum > 0; будущие/пустые — без сравнения.
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'period', dir: 'desc' });
  const rows = useMemo(() => {
    const byKey = new Map<number, number>();
    for (const p of data ?? []) if (p.toSum != null && p.toSum > 0) byKey.set(p.year * 12 + p.month, p.toSum);
    const aug = (data ?? []).map(p => {
      const cur = p.toSum != null && p.toSum > 0 ? p.toSum : null;
      const py = byKey.get((p.year - 1) * 12 + p.month) ?? null;
      const pmKey = p.month === 1 ? (p.year - 1) * 12 + 12 : p.year * 12 + (p.month - 1);
      const pm = byKey.get(pmKey) ?? null;
      const f = focusMap.get(`${p.year}-${p.month}`);
      return {
        year: p.year, month: p.month, period: p.year * 12 + p.month,
        toSum: p.toSum, toPerM2: p.toPerM2, purchases: p.purchases, ap: p.ap,
        yoy: cur != null && py ? cur / py - 1 : null,
        mom: cur != null && pm ? cur / pm - 1 : null,
        avgCheck: f?.avgCheck ?? null,
        receipts: f?.receipts ?? null,
      };
    });
    aug.sort((a, b) => {
      const av = (a as Record<string, number | null>)[sort.key];
      const bv = (b as Record<string, number | null>)[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return aug;
  }, [data, focusMap, sort]);
  function toggleSort(key: string) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }
  const cols: { key: string; label: string; align: 'left' | 'right' }[] = [
    { key: 'period', label: 'Период', align: 'left' },
    { key: 'toSum', label: 'ТО', align: 'right' },
    { key: 'toPerM2', label: 'ТО/м²', align: 'right' },
    { key: 'yoy', label: 'YoY %', align: 'right' },
    { key: 'mom', label: 'MoM %', align: 'right' },
    { key: 'purchases', label: 'Покупок', align: 'right' },
    ...(hasFocus
      ? [{ key: 'avgCheck', label: 'Ср. чек', align: 'right' as const },
         { key: 'receipts', label: 'Чеков', align: 'right' as const }]
      : []),
    { key: 'ap', label: 'АП', align: 'right' },
  ];

  const modalRef = useRef<HTMLDivElement>(null);
  function handlePrint() {
    const canvas = modalRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    const chartDataUrl = canvas ? canvas.toDataURL('image/png') : undefined;
    const printRows = rows
      .filter(r => (r.toSum != null && r.toSum > 0) || (r.receipts != null && r.receipts > 0))
      .sort((a, b) => a.period - b.period);
    const pctCell = (v: number | null): PrintCell => v == null ? '—'
      : { text: (v > 0 ? '+' : '') + fmtPct(v * 100, 1), color: v > 0 ? '#15803d' : v < 0 ? '#b91c1c' : '#555' };
    const printColumns = [
      { label: 'Период', align: 'left' as const },
      { label: 'ТО', align: 'right' as const },
      { label: 'ТО/м²', align: 'right' as const },
      { label: 'YoY %', align: 'right' as const },
      { label: 'MoM %', align: 'right' as const },
      { label: 'Покупок', align: 'right' as const },
      ...(hasFocus ? [{ label: 'Ср. чек', align: 'right' as const }, { label: 'Чеков', align: 'right' as const }] : []),
      { label: 'АП', align: 'right' as const },
    ];
    const printData: PrintCell[][] = printRows.map(r => [
      `${MONTH_NAMES_SHORT[r.month - 1]} ${r.year}`,
      r.toSum != null ? fmtShort(r.toSum) + ' ₽' : '—',
      r.toPerM2 != null ? fmtShort(r.toPerM2) : '—',
      pctCell(r.yoy),
      pctCell(r.mom),
      r.purchases != null ? fmtInt(r.purchases) : '—',
      ...(hasFocus ? [
        r.avgCheck != null ? fmtInt(r.avgCheck) + ' ₽' : '—',
        r.receipts != null ? fmtInt(r.receipts) : '—',
      ] : []),
      r.ap != null ? fmtShort(r.ap) : '—',
    ]);
    printReport({
      title: store,
      meta: [
        `Помесячная история · ${printData.length} мес. с данными`,
        lastFocus
          ? `Focus: средний чек ${lastFocus.avgCheck != null ? fmtInt(lastFocus.avgCheck) + ' ₽' : '—'}, чеков/мес ${lastFocus.receipts != null ? fmtInt(lastFocus.receipts) : '—'}`
          : '',
      ].filter(Boolean),
      chartDataUrl,
      columns: printColumns,
      rows: printData,
    });
  }

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
      <div ref={modalRef}
           className="bg-surface border border-border rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{store}</h2>
            <p className="text-xs text-muted mt-1">
              Помесячная история по всем годам
              {lastFocus && (
                <span className="text-accent">
                  {'  ·  Focus: ср. чек '}{lastFocus.avgCheck != null ? fmtInt(lastFocus.avgCheck) + ' ₽' : '—'}
                  {', чеков/мес '}{lastFocus.receipts != null ? fmtInt(lastFocus.receipts) : '—'}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface2 border border-border text-text hover:border-accent/40">
              <Printer size={14} /> Печать
            </button>
            <button onClick={onClose} className="text-muted hover:text-text p-1.5">
              <X size={18} />
            </button>
          </div>
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
                      {cols.map(c => (
                        <th key={c.key}
                          onClick={() => toggleSort(c.key)}
                          className={cn('px-5 py-2 font-medium cursor-pointer select-none hover:text-text whitespace-nowrap',
                            c.align === 'left' ? 'text-left' : 'text-right',
                            (c.key === 'avgCheck' || c.key === 'receipts') && 'text-accent',
                            sort.key === c.key && 'text-text')}>
                          {c.label}
                          <span className="ml-1 text-[9px]">
                            {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-surface2/50">
                        {cols.map(c => {
                          if (c.key === 'period')
                            return <td key={c.key} className="px-5 py-2 num whitespace-nowrap">{MONTH_NAMES_SHORT[r.month - 1]} {r.year}</td>;
                          if (c.key === 'toSum')
                            return <td key={c.key} className="px-5 py-2 text-right num font-semibold">{r.toSum != null ? fmtShort(r.toSum) + ' ₽' : '—'}</td>;
                          if (c.key === 'toPerM2')
                            return <td key={c.key} className="px-5 py-2 text-right num text-muted">{r.toPerM2 != null ? fmtShort(r.toPerM2) : '—'}</td>;
                          if (c.key === 'yoy' || c.key === 'mom') {
                            const v = c.key === 'yoy' ? r.yoy : r.mom;
                            return <td key={c.key} className={cn('px-5 py-2 text-right num',
                              v == null ? 'text-muted' : v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-muted')}>
                              {v != null ? (v > 0 ? '+' : '') + fmtPct(v * 100, 1) : '—'}</td>;
                          }
                          if (c.key === 'purchases')
                            return <td key={c.key} className="px-5 py-2 text-right num text-muted">{r.purchases != null ? fmtInt(r.purchases) : '—'}</td>;
                          if (c.key === 'avgCheck')
                            return <td key={c.key} className="px-5 py-2 text-right num">{r.avgCheck != null ? fmtInt(r.avgCheck) + ' ₽' : '—'}</td>;
                          if (c.key === 'receipts')
                            return <td key={c.key} className="px-5 py-2 text-right num">{r.receipts != null ? fmtInt(r.receipts) : '—'}</td>;
                          return <td key={c.key} className="px-5 py-2 text-right num text-muted">{r.ap != null ? fmtShort(r.ap) : '—'}</td>;
                        })}
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
