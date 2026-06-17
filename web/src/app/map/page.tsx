'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card } from '@/components/Card';
import { fmtShort, fmtInt, fmtRub, cn } from '@/lib/utils';
import { Pencil, Eye, Trash2, Check, X, MapPinned } from 'lucide-react';

type Metric = 'to' | 'to_per_m2' | 'receipts' | 'avg_check';
type Zone = { id: number; floor: number; storeName: string; points: [number, number][] };
type MapData = {
  floor: number; year: number | null; viewBox: string;
  zones: Zone[];
  stores: { storeName: string; category: string | null }[];
  metrics: Record<Metric, Record<string, number>>;
};

const FLOORS = [1, 2, 3, 4];
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'to',        label: 'Товарооборот', unit: '₽' },
  { id: 'to_per_m2', label: 'ТО на м²',     unit: '₽/м²' },
  { id: 'receipts',  label: 'Число чеков',  unit: 'шт' },
  { id: 'avg_check', label: 'Средний чек',  unit: '₽' },
];

// Низкий = плохо (красный) → высокий = очень хорошо (лайм), как в сезонной карте.
function colorForPct(pct: number): string {
  return pct < 0.2 ? 'rgba(239, 68, 68, 0.62)'
    : pct < 0.4 ? 'rgba(251, 146, 60, 0.58)'
    : pct < 0.6 ? 'rgba(251, 191, 36, 0.60)'
    : pct < 0.8 ? 'rgba(52, 211, 153, 0.55)'
    :             'rgba(163, 230, 53, 0.68)';
}
function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length || 1;
  const sx = pts.reduce((s, p) => s + p[0], 0) / n;
  const sy = pts.reduce((s, p) => s + p[1], 0) / n;
  return [sx, sy];
}
function fmtMetric(v: number, m: Metric): string {
  if (m === 'receipts') return fmtInt(v) + ' шт';
  if (m === 'avg_check') return fmtInt(v) + ' ₽';
  return fmtShort(v) + ' ₽';
}

export default function MapPage() {
  const [floor, setFloor] = useState(4);
  const [data, setData] = useState<MapData | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [metric, setMetric] = useState<Metric>('to');
  const [hover, setHover] = useState<number | null>(null);
  // редактор
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [pickStore, setPickStore] = useState<string>('');
  const svgRef = useRef<SVGSVGElement>(null);

  function reload() {
    fetch(`/api/map/data?floor=${floor}`).then(r => r.json()).then(setData).catch(() => {});
  }
  useEffect(() => { setData(null); setDraft([]); reload(); /* eslint-disable-next-line */ }, [floor]);

  // значения метрики по магазину + перцентиль для цвета
  const metricMap = data?.metrics[metric] ?? {};
  const pct = useMemo(() => {
    const vals = Object.values(metricMap).filter(v => v != null).sort((a, b) => a - b);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(metricMap)) {
      const below = vals.filter(x => x <= v).length;
      out[k] = vals.length > 1 ? (below - 1) / (vals.length - 1) : 1;
    }
    return out;
  }, [metricMap]);

  const ranking = useMemo(() => {
    if (!data) return [];
    return data.zones
      .map(z => ({ zone: z, v: metricMap[z.storeName] }))
      .filter(r => r.v != null)
      .sort((a, b) => (b.v as number) - (a.v as number));
  }, [data, metricMap]);

  function toSvg(e: React.MouseEvent): [number, number] {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = pt.matrixTransform(ctm.inverse());
    return [Math.round(p.x), Math.round(p.y)];
  }
  function onMapClick(e: React.MouseEvent) {
    if (mode !== 'edit') return;
    setDraft(d => [...d, toSvg(e)]);
  }
  async function saveDraft() {
    if (draft.length < 3 || !pickStore) return;
    await fetch('/api/map/zones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ floor, storeName: pickStore, points: draft }),
    });
    setDraft([]); setPickStore(''); reload();
  }
  async function delZone(id: number) {
    await fetch(`/api/map/zones/${id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1700px] mx-auto px-6 py-8 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><MapPinned size={26} /> Метрики на карте</h1>
            <p className="text-sm text-muted mt-1">
              Планы этажей с зонами арендаторов, раскрашенными по метрике. Размечайте зоны один раз —
              дальше они красятся любым показателем. Год: {data?.year ?? '…'}.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* этажи */}
            <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl">
              {FLOORS.map(f => (
                <button key={f} onClick={() => setFloor(f)}
                  className={cn('px-3 py-1.5 rounded-lg text-sm font-medium',
                    f === floor ? 'bg-accent/20 text-accent border border-accent/40' : 'text-muted hover:text-text')}>
                  {f} эт
                </button>
              ))}
            </div>
            {/* режим */}
            <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl">
              <button onClick={() => { setMode('view'); setDraft([]); }}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
                  mode === 'view' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                <Eye size={14} /> Просмотр
              </button>
              <button onClick={() => setMode('edit')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
                  mode === 'edit' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                <Pencil size={14} /> Разметка
              </button>
            </div>
          </div>
        </div>

        {/* метрика (просмотр) */}
        {mode === 'view' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted">Метрика:</span>
            <div className="flex gap-1 p-1 bg-surface2 border border-border rounded-lg">
              {METRICS.map(m => (
                <button key={m.id} onClick={() => setMetric(m.id)}
                  className={cn('px-3 py-1.5 rounded-md text-sm font-medium',
                    metric === m.id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="ml-2 text-xs text-muted inline-flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded" style={{ background: colorForPct(0.05) }} /> ниже
              <span className="inline-block w-3 h-3 rounded" style={{ background: colorForPct(0.5) }} /> средне
              <span className="inline-block w-3 h-3 rounded" style={{ background: colorForPct(0.95) }} /> выше
              <span className="inline-block w-3 h-3 rounded bg-surface2 border border-border" /> нет данных
            </span>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          {/* Карта */}
          <Card className="p-0 overflow-hidden">
            {!data ? (
              <div className="aspect-[297/210] grid place-items-center text-muted text-sm">Загрузка плана…</div>
            ) : (
              <div className="relative w-full" style={{ aspectRatio: '297 / 210' }}>
                {/* подложка-план */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/map/plan/${floor}`} alt={`План ${floor} этажа`}
                  className="absolute inset-0 w-full h-full select-none pointer-events-none bg-white" />
                {/* слой зон */}
                <svg ref={svgRef} viewBox={data.viewBox}
                  className={cn('absolute inset-0 w-full h-full', mode === 'edit' && 'cursor-crosshair')}
                  onClick={onMapClick}>
                  {data.zones.map(z => {
                    const v = metricMap[z.storeName];
                    const fill = mode === 'edit'
                      ? 'rgba(96,165,250,0.25)'
                      : v != null ? colorForPct(pct[z.storeName] ?? 0) : 'rgba(148,163,184,0.18)';
                    const [cx, cy] = centroid(z.points);
                    return (
                      <g key={z.id}
                        onMouseEnter={() => setHover(z.id)} onMouseLeave={() => setHover(null)}
                        style={{ cursor: mode === 'edit' ? 'crosshair' : 'pointer' }}>
                        <polygon
                          points={z.points.map(p => p.join(',')).join(' ')}
                          fill={fill}
                          stroke={hover === z.id ? '#fff' : 'rgba(255,255,255,0.5)'}
                          strokeWidth={hover === z.id ? 28 : 12} />
                        {mode === 'view' && (
                          <text x={cx} y={cy} textAnchor="middle"
                            fontSize={180} fill="#0b1220" fontWeight={700}
                            style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.85)', strokeWidth: 40 }}>
                            {z.storeName}
                            {v != null && <tspan x={cx} dy={200} fontSize={150} fontWeight={500}>{fmtMetric(v, metric)}</tspan>}
                          </text>
                        )}
                        {mode === 'edit' && (
                          <text x={cx} y={cy} textAnchor="middle" fontSize={170} fill="#1e3a8a" fontWeight={700}
                            style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 40 }}>{z.storeName}</text>
                        )}
                      </g>
                    );
                  })}
                  {/* черновик полигона */}
                  {draft.length > 0 && (
                    <>
                      <polyline points={draft.map(p => p.join(',')).join(' ')}
                        fill="rgba(96,165,250,0.25)" stroke="#60a5fa" strokeWidth={20} />
                      {draft.map((p, i) => (
                        <circle key={i} cx={p[0]} cy={p[1]} r={45} fill="#60a5fa" stroke="#fff" strokeWidth={12} />
                      ))}
                    </>
                  )}
                </svg>
              </div>
            )}
          </Card>

          {/* Боковая панель */}
          <div className="space-y-4">
            {mode === 'edit' ? (
              <Card>
                <div className="font-semibold mb-2 flex items-center gap-2"><Pencil size={15} /> Разметка зон</div>
                <p className="text-xs text-muted mb-3">
                  Кликами по плану обведите контур магазина (≥3 точки), выберите магазин и сохраните.
                  Зона свяжется с товарооборотом по названию.
                </p>
                <div className="text-xs text-muted mb-1">Точек в контуре: <span className="text-text font-semibold">{draft.length}</span></div>
                <select value={pickStore} onChange={e => setPickStore(e.target.value)}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm mb-2 focus:border-accent outline-none">
                  <option value="">— выбрать магазин —</option>
                  {data?.stores.map(s => (
                    <option key={s.storeName} value={s.storeName}>{s.storeName}{s.category ? ` · ${s.category}` : ''}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={saveDraft} disabled={draft.length < 3 || !pickStore}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-good/20 text-good border border-good/30 disabled:opacity-50">
                    <Check size={14} /> Сохранить зону
                  </button>
                  <button onClick={() => setDraft([])} disabled={!draft.length}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-surface2 border border-border text-muted hover:text-text disabled:opacity-50">
                    <X size={14} />
                  </button>
                </div>

                <div className="mt-4 text-xs text-muted uppercase tracking-wider">Зоны этажа · {data?.zones.length ?? 0}</div>
                <div className="mt-1 max-h-[320px] overflow-y-auto -mx-1">
                  {data?.zones.map(z => (
                    <div key={z.id} className="flex items-center justify-between px-1 py-1.5 text-sm border-b border-border/40">
                      <span className="truncate">{z.storeName}</span>
                      <button onClick={() => delZone(z.id)} className="text-muted hover:text-bad p-1"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {data && data.zones.length === 0 && <div className="text-xs text-muted py-3">Зон пока нет</div>}
                </div>
              </Card>
            ) : (
              <Card>
                <div className="font-semibold mb-1">Рейтинг · {METRICS.find(m => m.id === metric)?.label}</div>
                <div className="text-xs text-muted mb-2">{ranking.length} зон с данными из {data?.zones.length ?? 0}</div>
                <div className="max-h-[560px] overflow-y-auto -mx-1">
                  {ranking.map(({ zone, v }, i) => (
                    <div key={zone.id}
                      onMouseEnter={() => setHover(zone.id)} onMouseLeave={() => setHover(null)}
                      className={cn('flex items-center gap-2 px-1.5 py-1.5 text-sm border-b border-border/40 rounded',
                        hover === zone.id && 'bg-surface2')}>
                      <span className="w-5 text-right text-xs text-muted num">{i + 1}</span>
                      <span className="w-2.5 h-4 rounded-sm shrink-0" style={{ background: colorForPct(pct[zone.storeName] ?? 0) }} />
                      <span className="flex-1 truncate">{zone.storeName}</span>
                      <span className="num font-semibold">{fmtMetric(v as number, metric)}</span>
                    </div>
                  ))}
                  {ranking.length === 0 && (
                    <div className="text-xs text-muted py-4 text-center">
                      Нет размеченных зон с данными. Перейдите в «Разметку» и обведите магазины.
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
