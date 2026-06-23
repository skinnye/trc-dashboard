'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card } from '@/components/Card';
import { StoreDrillModal } from '@/components/StoreDrillModal';
import { MapPeople, type PeopleTarget } from '@/components/MapPeople';
import { fmtShort, fmtInt, cn } from '@/lib/utils';
import { Pencil, Eye, Trash2, Check, X, MapPinned, ZoomIn, ZoomOut, Maximize2, Flame, LayoutGrid, Users } from 'lucide-react';

type Metric = 'to' | 'to_per_m2' | 'receipts' | 'avg_check';
type Zone = { id: number; floor: number; storeName: string; points: [number, number][] };
type MapData = {
  floor: number; viewBox: string;
  bounds: { min: string; max: string } | null;
  period: { from: string; to: string };
  zones: Zone[];
  stores: { storeName: string; category: string | null }[];
  metrics: Record<Metric, Record<string, number>>;
};

const FLOORS = [1, 2, 3, 4];
const METRICS: { id: Metric; label: string }[] = [
  { id: 'to',        label: 'Товарооборот' },
  { id: 'to_per_m2', label: 'ТО на м²' },
  { id: 'receipts',  label: 'Число чеков' },
  { id: 'avg_check', label: 'Средний чек' },
];

// Непрерывная шкала: 0 = красный (худший) → 1 = ярко-лаймовый (лучший).
function heatColor(t: number, alpha = 1): string {
  const stops = [[239, 68, 68], [251, 146, 60], [251, 191, 36], [52, 211, 153], [163, 230, 53]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}
function bboxSize(pts: [number, number][]): number {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
function fmtMetric(v: number, m: Metric): string {
  if (m === 'receipts') return fmtInt(v) + ' шт';
  if (m === 'avg_check') return fmtInt(v) + ' ₽';
  return fmtShort(v) + ' ₽';
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function MapPage() {
  const [floor, setFloor] = useState(4);
  const [data, setData] = useState<MapData | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [metric, setMetric] = useState<Metric>('to');
  const [vmode, setVmode] = useState<'zones' | 'heat' | 'people'>('zones');
  const [traffic, setTraffic] = useState<{ floorTraffic: number; perimeterTraffic: number } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const isHeat = vmode === 'heat';
  const isPeople = vmode === 'people';
  const [hover, setHover] = useState<number | null>(null);
  const [drillStore, setDrillStore] = useState<string | null>(null);
  // редактор
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [pickStore, setPickStore] = useState('');
  // зум/пан
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  function reload() {
    const q = new URLSearchParams({ floor: String(floor) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    fetch(`/api/map/data?${q}`).then(r => r.json()).then((d: MapData) => {
      setData(d);
      if (!from && d.period) setFrom(d.period.from);
      if (!to && d.period) setTo(d.period.to);
    }).catch(() => {});
  }
  useEffect(() => { setDraft([]); reload(); /* eslint-disable-next-line */ }, [floor, from, to]);

  // Трафик этажа за период (MSSQL). Мягко деградирует, если БД недоступна.
  useEffect(() => {
    if (!from || !to) return;
    setTraffic(null);
    fetch(`/api/map/traffic?floor=${floor}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => setTraffic(d.ok ? { floorTraffic: d.floorTraffic, perimeterTraffic: d.perimeterTraffic } : null))
      .catch(() => setTraffic(null));
  }, [floor, from, to]);

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

  // Цели «человечков»: вес = число чеков; где чеков нет — оценка по ТО через
  // коэффициент чеки/ТО магазинов этажа, у которых есть и то и другое.
  const people = useMemo(() => {
    if (!data) return { targets: [] as PeopleTarget[], floorReceipts: 0, estimatedShare: 0 };
    const rec = data.metrics.receipts, to = data.metrics.to;
    let sr = 0, st = 0;
    for (const z of data.zones) {
      const r = rec[z.storeName], t = to[z.storeName];
      if (r != null && t != null && t > 0) { sr += r; st += t; }
    }
    const ratio = st > 0 ? sr / st : 0;
    let floorReceipts = 0, estCount = 0, total = 0;
    const targets: PeopleTarget[] = [];
    for (const z of data.zones) {
      const [cx, cy] = centroid(z.points);
      const r = rec[z.storeName], t = to[z.storeName];
      floorReceipts += r ?? 0;
      const weight = r != null ? r : (t != null ? (ratio > 0 ? t * ratio : t) : 0);
      if (weight > 0) {
        targets.push({ vx: cx, vy: cy, weight, estimated: r == null });
        total++; if (r == null) estCount++;
      }
    }
    return { targets, floorReceipts, estimatedShare: total ? estCount / total : 0 };
  }, [data]);

  const peopleCount = traffic?.floorTraffic
    ? clamp(Math.round(traffic.floorTraffic / 6000), 24, 90)
    : 45;
  const conversion = traffic?.floorTraffic && people.floorReceipts
    ? (people.floorReceipts / traffic.floorTraffic) * 100 : null;
  const [vbW, vbH] = (data?.viewBox ?? '0 0 29700 21000').split(/\s+/).map(Number).slice(2);

  // ── зум/пан ────────────────────────────────────────────────────────
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const ns = clamp(scale * k, 1, 10);
    const r = ns / scale;
    setPan(p => ({ x: mx - (mx - p.x) * r, y: my - (my - p.y) * r }));
    setScale(ns);
  }
  function onDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true;
    setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
  }
  function onLeave() { drag.current = null; }        // выход мыши — отмена, без точки
  function onUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;                       // точку ставим только на чистый клик по карте (был pointerdown, без сдвига)
    if (mode === 'edit' && wrapRef.current && data) {
      // Клик в режиме разметки → координата плана. Считаем сами (а не через
      // getScreenCTM, который врёт при CSS-transform зума/сдвига):
      //   экран → база (убираем translate/scale) → координаты viewBox.
      const rect = wrapRef.current.getBoundingClientRect();
      const [, , vbW, vbH] = data.viewBox.split(/\s+/).map(Number);
      const bx = (e.clientX - rect.left - pan.x) / scale;
      const by = (e.clientY - rect.top - pan.y) / scale;
      const vx = (bx / rect.width) * (vbW || 29700);
      const vy = (by / rect.height) * (vbH || 21000);
      setDraft(d => [...d, [Math.round(vx), Math.round(vy)]]);
    } else if (mode === 'view') {
      // клик по зоне → карточка арендатора
      const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
      const store = el?.closest('[data-store]')?.getAttribute('data-store');
      if (store) setDrillStore(store);
    }
  }
  function resetView() { setScale(1); setPan({ x: 0, y: 0 }); }

  async function saveDraft() {
    if (draft.length < 3 || !pickStore) return;
    await fetch('/api/map/zones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ floor, storeName: pickStore, points: draft }),
    });
    setDraft([]); setPickStore(''); reload();
  }
  async function delZone(id: number) { await fetch(`/api/map/zones/${id}`, { method: 'DELETE' }); reload(); }

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1700px] mx-auto px-6 py-8 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><MapPinned size={26} /> Метрики на карте</h1>
            <p className="text-sm text-muted mt-1">
              Тепловая карта этажей: красный — худшие, лаймовый — лучшие. Колесо — зум, перетаскивание — сдвиг, клик по зоне — карточка арендатора.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl">
              {FLOORS.map(f => (
                <button key={f} onClick={() => setFloor(f)}
                  className={cn('px-3 py-1.5 rounded-lg text-sm font-medium',
                    f === floor ? 'bg-accent/20 text-accent border border-accent/40' : 'text-muted hover:text-text')}>
                  {f} эт
                </button>
              ))}
            </div>
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

        {/* Панель управления просмотром */}
        {mode === 'view' && (
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <label className="text-muted">Метрика:</label>
            <select value={metric} onChange={e => setMetric(e.target.value as Metric)}
              className="bg-surface2 border border-border rounded-lg px-3 py-1.5 focus:border-accent outline-none">
              {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>

            <label className="text-muted ml-2">Период:</label>
            <input type="month" value={from} min={data?.bounds?.min} max={data?.bounds?.max}
              onChange={e => setFrom(e.target.value)}
              className="bg-surface2 border border-border rounded-lg px-2 py-1.5 focus:border-accent outline-none" />
            <span className="text-muted">—</span>
            <input type="month" value={to} min={data?.bounds?.min} max={data?.bounds?.max}
              onChange={e => setTo(e.target.value)}
              className="bg-surface2 border border-border rounded-lg px-2 py-1.5 focus:border-accent outline-none" />

            <div className="flex gap-1 p-1 bg-surface2 border border-border rounded-lg ml-2">
              {([
                { id: 'zones',  label: 'Зоны',      Icon: LayoutGrid },
                { id: 'heat',   label: 'Тепло',     Icon: Flame },
                { id: 'people', label: 'Человечки', Icon: Users },
              ] as const).map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setVmode(id)}
                  className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
                    vmode === id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text')}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>

            {isPeople ? (
              <div className="ml-auto inline-flex items-center gap-3 text-xs flex-wrap">
                <span className="text-muted">Трафик этажа: <b className="text-text num">{traffic ? fmtInt(traffic.floorTraffic) : '— (нет данных)'}</b></span>
                <span className="text-muted">Чеков: <b className="text-text num">{fmtInt(people.floorReceipts)}</b></span>
                {conversion != null && <span className="text-muted">Конверсия: <b className="text-good num">{conversion.toFixed(1)}%</b></span>}
                <span className="inline-flex items-center gap-1 text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(96,165,250,0.95)' }} />по чекам</span>
                <span className="inline-flex items-center gap-1 text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(251,191,36,0.9)' }} />оценка</span>
              </div>
            ) : (
              <div className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
                <span className="inline-block h-3 w-28 rounded"
                  style={{ background: 'linear-gradient(90deg, rgb(239,68,68), rgb(251,191,36), rgb(163,230,53))' }} />
                <span>худший → лучший</span>
              </div>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          {/* Карта */}
          <Card className="p-0 overflow-hidden relative">
            {/* зум-контролы */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
              <button onClick={() => setScale(s => clamp(s * 1.3, 1, 10))} className="p-2 rounded-lg bg-surface/90 border border-border hover:border-accent/40"><ZoomIn size={15} /></button>
              <button onClick={() => setScale(s => clamp(s / 1.3, 1, 10))} className="p-2 rounded-lg bg-surface/90 border border-border hover:border-accent/40"><ZoomOut size={15} /></button>
              <button onClick={resetView} className="p-2 rounded-lg bg-surface/90 border border-border hover:border-accent/40"><Maximize2 size={15} /></button>
            </div>
            {!data ? (
              <div className="aspect-[297/210] grid place-items-center text-muted text-sm">Загрузка плана…</div>
            ) : (
              <div ref={wrapRef}
                className={cn('relative w-full overflow-hidden touch-none',
                  mode === 'edit' ? 'cursor-crosshair' : drag.current ? 'cursor-grabbing' : 'cursor-grab')}
                style={{ aspectRatio: '297 / 210' }}
                onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave}>
                <div className="absolute inset-0 origin-top-left"
                  style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/map/plan/${floor}`} alt={`План ${floor} этажа`}
                    className="absolute inset-0 w-full h-full select-none pointer-events-none bg-white" draggable={false} />
                  <svg ref={svgRef} viewBox={data.viewBox} className="absolute inset-0 w-full h-full">
                    <defs>
                      <filter id="heatblur" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="320" />
                      </filter>
                    </defs>

                    {/* Режим ТЕПЛО — размытые пятна по центрам зон */}
                    {mode === 'view' && isHeat && (
                      <g filter="url(#heatblur)">
                        {data.zones.map(z => {
                          const v = metricMap[z.storeName];
                          if (v == null) return null;
                          const [cx, cy] = centroid(z.points);
                          const r = clamp(bboxSize(z.points) * 0.62, 700, 3600);
                          return <circle key={z.id} cx={cx} cy={cy} r={r} fill={heatColor(pct[z.storeName] ?? 0, 0.6)} />;
                        })}
                      </g>
                    )}

                    {data.zones.map(z => {
                      const v = metricMap[z.storeName];
                      // в режиме «человечки» зоны бледные (фон под фигурками)
                      const fill = mode === 'edit'
                        ? 'rgba(96,165,250,0.25)'
                        : isHeat ? 'transparent'
                        : v != null ? heatColor(pct[z.storeName] ?? 0, isPeople ? 0.22 : 0.6) : 'rgba(148,163,184,0.14)';
                      const [cx, cy] = centroid(z.points);
                      return (
                        <g key={z.id} data-store={z.storeName}
                          onMouseEnter={() => setHover(z.id)} onMouseLeave={() => setHover(null)}
                          style={{ cursor: mode === 'edit' ? 'crosshair' : 'pointer' }}>
                          <polygon points={z.points.map(p => p.join(',')).join(' ')}
                            fill={fill}
                            stroke={hover === z.id ? '#fff' : isHeat ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)'}
                            strokeWidth={hover === z.id ? 28 : 12} />
                          {mode === 'view' && (
                            <text x={cx} y={cy} textAnchor="middle" fontSize={340} fill="#0b1220" fontWeight={800}
                              style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.9)', strokeWidth: 80 }}>
                              {z.storeName}
                              {v != null && <tspan x={cx} dy={380} fontSize={300} fontWeight={700}>{fmtMetric(v, metric)}</tspan>}
                            </text>
                          )}
                          {mode === 'edit' && (
                            <text x={cx} y={cy} textAnchor="middle" fontSize={320} fill="#1e3a8a" fontWeight={800}
                              style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 80 }}>{z.storeName}</text>
                          )}
                        </g>
                      );
                    })}

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
                {mode === 'view' && isPeople && people.targets.length > 0 && (
                  <MapPeople targets={people.targets} vbW={vbW || 29700} vbH={vbH || 21000}
                    pan={pan} scale={scale} count={peopleCount} />
                )}
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
                  Зум/сдвиг работают и здесь — клик без перетаскивания ставит точку.
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
                <div className="text-xs text-muted mb-2">
                  {ranking.length} зон с данными из {data?.zones.length ?? 0}
                  {data?.period && <> · {data.period.from} — {data.period.to}</>}
                </div>
                <div className="max-h-[560px] overflow-y-auto -mx-1">
                  {ranking.map(({ zone, v }, i) => (
                    <div key={zone.id}
                      onMouseEnter={() => setHover(zone.id)} onMouseLeave={() => setHover(null)}
                      className={cn('flex items-center gap-2 px-1.5 py-1.5 text-sm border-b border-border/40 rounded',
                        hover === zone.id && 'bg-surface2')}>
                      <span className="w-5 text-right text-xs text-muted num">{i + 1}</span>
                      <span className="w-2.5 h-4 rounded-sm shrink-0" style={{ background: heatColor(pct[zone.storeName] ?? 0) }} />
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

        {/* Карточка арендатора по клику на зону */}
        {drillStore && (
          <StoreDrillModal store={drillStore} onClose={() => setDrillStore(null)} />
        )}
      </main>
    </>
  );
}
