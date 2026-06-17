'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, cn } from '@/lib/utils';
import { ExternalLink, Search, Database, Layers, Building2, Star, Map as MapIcon, MapPin, Globe, Store } from 'lucide-react';

// Heatmap тащит Leaflet, который не дружит с SSR. ssr:false +
// fallback-плейсхолдер, пока чанк качается.
const Heatmap = dynamic(() => import('@/components/Heatmap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] grid place-items-center text-sm text-muted bg-surface2 rounded-lg border border-border">
      Загрузка карты…
    </div>
  ),
});

type Summary = {
  categoriesCount: number;
  orgsCount: number;
  duplicatesCount: number;
  runs: number;
  lastRun: { id: number; startedAt: string; finishedAt: string | null; status: string; totalOrgs: number | null } | null;
};
type Dynamics = {
  hasMultipleRuns: boolean;
  latestRunId: number | null;
  newcomersCount: number;
  dropoutsCount: number;
};
type Category = {
  id: number;
  name: string;
  searchUrl: string;
  orgsCount: number;
  duplicatesCount: number;
  avgRating: number | null;
  totalReviews: number | null;
};
type MapPoint = {
  orgId: number; name: string;
  categoryId: number; categoryName: string;
  lat: number; lng: number;
  rating: number | null; reviews: number | null;
};
type HeatMode = 'count' | 'reviews' | 'rating';
type ScopeInfo = { scope: string; label: string; runId: number; startedAt: string; orgs: number };

export default function ExternalPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dynamics, setDynamics] = useState<Dynamics | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[] | null>(null);
  const [mapCategory, setMapCategory] = useState<number | 'all'>('all');
  const [heatMode, setHeatMode] = useState<HeatMode>('count');
  const [scope, setScope] = useState('district');
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);

  useEffect(() => {
    fetch(`/api/external/summary?scope=${encodeURIComponent(scope)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => {
        setSummary(d.summary);
        setCategories(d.categories);
        setDynamics(d.dynamics ?? null);
        if (d.scopes) setScopes(d.scopes);
      })
      .catch(() => setError('Не удалось загрузить данные'));
  }, [scope]);

  // Точки карты грузим под выбранный охват — фильтр по категории в браузере.
  useEffect(() => {
    setMapPoints(null);
    fetch(`/api/external/map?scope=${encodeURIComponent(scope)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setMapPoints(d.points))
      .catch(() => {});
  }, [scope]);

  const filteredMapPoints = useMemo(() => {
    if (!mapPoints) return [];
    return mapCategory === 'all'
      ? mapPoints
      : mapPoints.filter(p => p.categoryId === mapCategory);
  }, [mapPoints, mapCategory]);

  // Веса точек: «count» = все 1, «reviews» = log(reviews+1), «rating» = rating/5.
  // log нужен для отзывов, иначе одна точка с 5000 отзывов сожрёт всю карту.
  const heatPoints = useMemo(() => {
    return filteredMapPoints.map(p => ({
      lat: p.lat, lng: p.lng,
      weight:
        heatMode === 'count'   ? 1 :
        heatMode === 'reviews' ? Math.log10((p.reviews ?? 0) + 1) :
        heatMode === 'rating'  ? (p.rating ?? 0) / 5 :
        1,
    }));
  }, [filteredMapPoints, heatMode]);

  // Топ-20 категорий по числу организаций — bar-chart на главную.
  const topCategoriesChart = useMemo(() => {
    const top = [...categories].slice(0, 20);
    if (top.length === 0) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: top.map(c => c.name),
        datasets: [{
          label: 'Организаций',
          data: top.map(c => c.orgsCount),
          backgroundColor: '#60a5fa',
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y' as const,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' } }, y: { grid: { display: false } } },
      },
    };
  }, [categories]);

  // Распределение рейтингов по категориям (топ-20 по отзывам).
  const ratingsChart = useMemo(() => {
    const top = [...categories]
      .filter(c => c.avgRating != null && c.totalReviews != null && c.totalReviews > 100)
      .sort((a, b) => (b.totalReviews ?? 0) - (a.totalReviews ?? 0))
      .slice(0, 20);
    if (top.length === 0) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: top.map(c => c.name),
        datasets: [{
          label: 'Средний рейтинг',
          data: top.map(c => c.avgRating ?? 0),
          backgroundColor: top.map(c =>
            (c.avgRating ?? 0) >= 4.5 ? '#34d399' :
            (c.avgRating ?? 0) >= 3.5 ? '#fbbf24' : '#f87171'),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y' as const,
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 5, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { grid: { display: false } },
        },
      },
    };
  }, [categories]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(c => c.name.toLowerCase().includes(q));
  }, [filter, categories]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Внешний контур · 2GIS</h1>
            <p className="text-sm text-muted mt-1">
              Снапшоты категорий и организаций. Охват: район Академический (границы из ссылок),
              весь Екатеринбург или другой ТРЦ.
            </p>
          </div>
          {dynamics?.hasMultipleRuns && (
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-good/10 border border-good/30 text-good">
                <span className="font-semibold num">+{fmtInt(dynamics.newcomersCount)}</span>
                <span className="text-xs">появилось</span>
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bad/10 border border-bad/30 text-bad">
                <span className="font-semibold num">−{fmtInt(dynamics.dropoutsCount)}</span>
                <span className="text-xs">исчезло</span>
              </span>
              <span className="text-xs text-muted">за последний прогон</span>
            </div>
          )}
        </div>

        {error && (
          <Card className="bg-bad/10 border-bad/30 text-bad text-sm">{error}</Card>
        )}

        {/* Scope selector — район / город / другие ТРЦ */}
        {scopes.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted">Охват:</span>
            <div className="flex gap-1 p-1 bg-surface border border-border rounded-xl overflow-x-auto">
              {scopes.map(s => {
                const Icon = s.scope === 'district' ? MapPin : s.scope === 'city' ? Globe : Store;
                return (
                  <button key={s.scope}
                    onClick={() => { setScope(s.scope); setMapCategory('all'); }}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                      scope === s.scope
                        ? 'bg-accent/20 text-accent border border-accent/40'
                        : 'text-muted hover:text-text hover:bg-surface2 border border-transparent',
                    )}>
                    <Icon size={14} />
                    {s.label}
                    <span className="text-xs text-muted">· {fmtInt(s.orgs)}</span>
                  </button>
                );
              })}
            </div>
            {scopes.find(s => s.scope === scope) && (
              <span className="text-xs text-muted">
                прогон от {scopes.find(s => s.scope === scope)!.startedAt.slice(0, 10)}
              </span>
            )}
          </div>
        )}

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <Stat
              label="Категорий"
              value={summary ? fmtInt(summary.categoriesCount) : '…'}
              sub={<span className="flex items-center gap-1"><Layers size={11} /> в работе</span>}
              accent="accent"
            />
          </Card>
          <Card>
            <Stat
              label="Организаций"
              value={summary ? fmtInt(summary.orgsCount) : '…'}
              sub={summary ? `${fmtInt(summary.duplicatesCount)} дублей` : null}
              accent="good"
            />
          </Card>
          <Card>
            <Stat
              label="Прогонов"
              value={summary ? fmtInt(summary.runs) : '…'}
              sub={summary?.lastRun
                ? <>последний · <span className="text-text">{summary.lastRun.startedAt.slice(0, 10)}</span></>
                : null}
            />
          </Card>
          <Card>
            <Stat
              label="Статус"
              value={
                !summary?.lastRun ? '—' :
                summary.lastRun.status === 'ok' ? 'OK' :
                summary.lastRun.status === 'running' ? 'идёт' :
                'ошибка'
              }
              sub={summary?.lastRun?.totalOrgs != null
                ? `${fmtInt(summary.lastRun.totalOrgs)} карточек`
                : null}
              accent={
                summary?.lastRun?.status === 'ok' ? 'good' :
                summary?.lastRun?.status === 'running' ? 'warn' :
                summary?.lastRun ? 'bad' : undefined
              }
            />
          </Card>
        </div>

        {/* Heatmap */}
        <Card>
          <CardHeader
            title="Тепловая карта · где чего больше"
            subtitle={`${fmtInt(filteredMapPoints.length)} точек с координатами`}
            right={
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={mapCategory}
                  onChange={e => setMapCategory(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none max-w-[220px]"
                >
                  <option value="all">Все категории ({fmtInt(mapPoints?.length ?? 0)})</option>
                  {categories
                    .filter(c => c.orgsCount > 0)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.orgsCount})</option>
                    ))}
                </select>
                <div className="flex items-center gap-1 p-1 bg-surface2 border border-border rounded-lg">
                  {(['count', 'reviews', 'rating'] as HeatMode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setHeatMode(m)}
                      className={cn(
                        'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                        heatMode === m
                          ? 'bg-accent/20 text-accent'
                          : 'text-muted hover:text-text',
                      )}
                    >
                      {m === 'count' ? 'кол-во' : m === 'reviews' ? 'по отзывам' : 'по рейтингу'}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
          <Heatmap
            points={heatPoints}
            height={520}
            radius={heatMode === 'count' ? 18 : 24}
          />
          <div className="mt-3 text-xs text-muted flex items-center gap-3 flex-wrap">
            <MapIcon size={12} />
            <span>
              Режим «<b className="text-text">кол-во</b>» — каждая карточка весит одинаково.{' '}
              «<b className="text-text">по отзывам</b>» — вес = log(отзывы+1), популярные точки горят ярче.{' '}
              «<b className="text-text">по рейтингу</b>» — вес = rating/5, видно скопления хороших мест.
            </span>
          </div>
        </Card>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Топ-20 категорий по числу организаций" />
            {topCategoriesChart && <ChartWrap config={topCategoriesChart} height={520} />}
          </Card>
          <Card>
            <CardHeader
              title="Средний рейтинг по категориям"
              subtitle="Только категории с >100 отзывов · топ-20 по объёму отзывов"
            />
            {ratingsChart
              ? <ChartWrap config={ratingsChart} height={520} />
              : <div className="text-sm text-muted text-center py-12">
                  Недостаточно данных. Появится после первого прогона парсера.
                </div>}
          </Card>
        </div>

        {/* Categories */}
        <Card>
          <CardHeader
            title="Категории"
            subtitle="Кликните на название — список организаций и тренды по этой категории"
            right={
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Найти категорию…"
                  className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-64"
                />
              </div>
            }
          />
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left  px-5 py-2 font-medium">Категория</th>
                  <th className="text-right px-5 py-2 font-medium">Организаций</th>
                  <th className="text-right px-5 py-2 font-medium">Дубли</th>
                  <th className="text-right px-5 py-2 font-medium">Ср. рейтинг</th>
                  <th className="text-right px-5 py-2 font-medium">Отзывов</th>
                  <th className="text-center px-5 py-2 font-medium">2GIS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-muted py-6">
                    {summary ? 'Ничего не найдено' : 'Загрузка…'}
                  </td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-surface2/50">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/external/${c.id}?scope=${encodeURIComponent(scope)}`}
                        className="font-medium text-text hover:text-accent flex items-center gap-2"
                      >
                        <Building2 size={14} className="text-muted shrink-0" />
                        <span className="truncate max-w-[420px]">{c.name}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-right num font-semibold">{fmtInt(c.orgsCount)}</td>
                    <td className={cn('px-5 py-2.5 text-right num',
                      c.duplicatesCount > 0 ? 'text-warn' : 'text-muted')}>
                      {c.duplicatesCount > 0 ? fmtInt(c.duplicatesCount) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right num">
                      {c.avgRating != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Star size={12} className="text-warn fill-warn/40" />
                          {c.avgRating.toFixed(2)}
                        </span>
                      ) : <span className="text-muted/60">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right num text-muted">
                      {c.totalReviews != null ? fmtInt(c.totalReviews) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <a
                        href={c.searchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                        title="Открыть поиск в 2GIS"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="text-xs text-muted flex items-center gap-2 pt-2">
          <Database size={12} />
          Все рейтинги/отзывы сейчас пусты — заполнятся после первого прогона Python-парсера parser-2gis.
          Excel-импорт даёт только справочник и список организаций.
        </div>
      </main>
    </>
  );
}
