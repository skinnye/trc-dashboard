'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt, cn } from '@/lib/utils';
import { ChevronLeft, ExternalLink, Search, Star, Phone, Globe, TrendingUp, TrendingDown } from 'lucide-react';

type CategoryRow = {
  id: number;
  name: string;
  searchUrl: string;
  orgsCount: number;
  duplicatesCount: number;
  avgRating: number | null;
  totalReviews: number | null;
};
type OrgRow = {
  id: number;
  name: string;
  address: string | null;
  street: string | null;
  isDuplicate: number;
  firstSeenAt: string;
  lastSeenAt: string;
  rating: number | null;
  reviewsCount: number | null;
  website: string | null;
  phones: string | null;
  hours: string | null;
};
type Newcomer = {
  id: number; name: string; address: string | null; street: string | null;
  categoryId: number; categoryName: string;
  firstSeenAt: string; lastSeenAt: string;
};
type TrendPoint = {
  runId: number; capturedAt: string; orgs: number;
  avgRating: number | null; totalReviews: number | null;
};

export default function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ category: CategoryRow; orgs: OrgRow[] } | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dyn, setDyn] = useState<{ newcomers: Newcomer[]; dropouts: Newcomer[]; trend: TrendPoint[] } | null>(null);

  useEffect(() => {
    fetch(`/api/external/category/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setData)
      .catch(() => setError('Категория не найдена'));
    fetch(`/api/external/category/${id}/dynamics`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setDyn)
      .catch(() => {});
  }, [id]);

  // Тренд кол-ва организаций по прогонам — линейный график.
  // Строим только если прогонов больше одного, иначе отображать нечего.
  const trendChart = useMemo(() => {
    if (!dyn?.trend || dyn.trend.length < 2) return null;
    const labels = dyn.trend.map(p => p.capturedAt.slice(0, 10));
    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: [{
          label: 'Организаций',
          data: dyn.trend.map(p => p.orgs),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.15)',
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }, [dyn]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.orgs;
    return data.orgs.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.address ?? '').toLowerCase().includes(q) ||
      (o.street ?? '').toLowerCase().includes(q),
    );
  }, [filter, data]);

  // Группировка по улицам — удобно глазами пробегать.
  const groups = useMemo(() => {
    const map = new Map<string, OrgRow[]>();
    for (const o of filtered) {
      const k = o.street?.trim() || '— улица не указана';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return Array.from(map.entries()).sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru'),
    );
  }, [filtered]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <Link
          href="/external"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
        >
          <ChevronLeft size={14} />
          К списку категорий
        </Link>

        {error && (
          <Card className="bg-bad/10 border-bad/30 text-bad text-sm">{error}</Card>
        )}

        {data && (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold">{data.category.name}</h1>
                <p className="text-sm text-muted mt-1">
                  Категория «{data.category.name}» в Екатеринбурге · 2GIS
                </p>
              </div>
              <a
                href={data.category.searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                <ExternalLink size={14} />
                Открыть в 2GIS
              </a>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><Stat label="Организаций" value={fmtInt(data.category.orgsCount)} accent="accent" /></Card>
              <Card><Stat label="Дублей" value={fmtInt(data.category.duplicatesCount)}
                          accent={data.category.duplicatesCount > 0 ? 'warn' : undefined} /></Card>
              <Card><Stat label="Ср. рейтинг"
                          value={data.category.avgRating != null ? data.category.avgRating.toFixed(2) : '—'} /></Card>
              <Card><Stat label="Всего отзывов"
                          value={data.category.totalReviews != null ? fmtInt(data.category.totalReviews) : '—'} /></Card>
            </div>

            {/* Динамика категории */}
            {dyn && (dyn.newcomers.length > 0 || dyn.dropouts.length > 0 || (dyn.trend?.length ?? 0) > 1) && (
              <div className="grid lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader
                    title="Появилось"
                    subtitle="за последний прогон парсера"
                    right={<TrendingUp className="text-good" size={18} />}
                  />
                  {dyn.newcomers.length === 0 ? (
                    <div className="text-sm text-muted text-center py-4">Без изменений</div>
                  ) : (
                    <ul className="space-y-1.5 max-h-[280px] overflow-y-auto -mx-2 px-2">
                      {dyn.newcomers.slice(0, 30).map(o => (
                        <li key={o.id} className="text-sm flex items-start justify-between gap-2 py-0.5">
                          <Link href={`/external/org/${o.id}`} className="hover:text-accent truncate">
                            {o.name}
                          </Link>
                          <span className="text-xs text-muted shrink-0 num">{o.firstSeenAt.slice(0, 10)}</span>
                        </li>
                      ))}
                      {dyn.newcomers.length > 30 && (
                        <li className="text-xs text-muted text-center pt-1">
                          и ещё {dyn.newcomers.length - 30}
                        </li>
                      )}
                    </ul>
                  )}
                </Card>
                <Card>
                  <CardHeader
                    title="Исчезло"
                    subtitle="не появились в последнем прогоне"
                    right={<TrendingDown className="text-bad" size={18} />}
                  />
                  {dyn.dropouts.length === 0 ? (
                    <div className="text-sm text-muted text-center py-4">Без изменений</div>
                  ) : (
                    <ul className="space-y-1.5 max-h-[280px] overflow-y-auto -mx-2 px-2">
                      {dyn.dropouts.slice(0, 30).map(o => (
                        <li key={o.id} className="text-sm flex items-start justify-between gap-2 py-0.5 opacity-70">
                          <Link href={`/external/org/${o.id}`} className="hover:text-accent line-through truncate">
                            {o.name}
                          </Link>
                          <span className="text-xs text-muted shrink-0 num">{o.lastSeenAt.slice(0, 10)}</span>
                        </li>
                      ))}
                      {dyn.dropouts.length > 30 && (
                        <li className="text-xs text-muted text-center pt-1">
                          и ещё {dyn.dropouts.length - 30}
                        </li>
                      )}
                    </ul>
                  )}
                </Card>
                <Card>
                  <CardHeader
                    title="Кол-во по прогонам"
                    subtitle={`${fmtInt(dyn.trend?.length ?? 0)} точек`}
                  />
                  {trendChart
                    ? <ChartWrap config={trendChart} height={280} />
                    : <div className="text-sm text-muted text-center py-12">
                        Нужно минимум 2 прогона для графика. Сейчас {dyn.trend?.length ?? 0}.
                      </div>}
                </Card>
              </div>
            )}

            <Card>
              <CardHeader
                title="Организации"
                subtitle={`Сгруппированы по улицам · показано ${fmtInt(filtered.length)} из ${fmtInt(data.orgs.length)}`}
                right={
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="search"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="Имя или адрес…"
                      className="bg-surface2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:border-accent outline-none w-64"
                    />
                  </div>
                }
              />
              {groups.length === 0 ? (
                <div className="text-sm text-muted py-6 text-center">Ничего не найдено</div>
              ) : (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface z-10">
                      <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                        <th className="text-left  px-5 py-2 font-medium">Организация</th>
                        <th className="text-left  px-5 py-2 font-medium">Адрес</th>
                        <th className="text-right px-5 py-2 font-medium">Рейтинг</th>
                        <th className="text-right px-5 py-2 font-medium">Отзывы</th>
                        <th className="text-center px-5 py-2 font-medium">Контакты</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(([street, rows]) => (
                        <StreetGroup key={street} street={street} rows={rows} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}

function StreetGroup({ street, rows }: { street: string; rows: OrgRow[] }) {
  return (
    <>
      <tr className="bg-surface2/40">
        <td colSpan={5}
            className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-muted font-semibold border-y border-border">
          {street} · {rows.length}
        </td>
      </tr>
      {rows.map(o => <OrgRowItem key={o.id} row={o} />)}
    </>
  );
}

function OrgRowItem({ row }: { row: OrgRow }) {
  const phones: string[] = (() => {
    if (!row.phones) return [];
    try { return JSON.parse(row.phones); } catch { return []; }
  })();
  const ratingTone =
    row.rating == null ? '' :
    row.rating >= 4.5 ? 'text-good' :
    row.rating >= 3.5 ? 'text-warn' : 'text-bad';

  return (
    <tr className="border-b border-border/50 hover:bg-surface2/50">
      <td className="px-5 py-2.5">
        <Link
          href={`/external/org/${row.id}`}
          className="font-medium text-text hover:text-accent"
        >
          {row.name}
        </Link>
        {row.isDuplicate === 1 && (
          <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn/20 text-warn font-semibold">
            дубль
          </span>
        )}
      </td>
      <td className="px-5 py-2.5 text-muted text-xs">{row.address ?? '—'}</td>
      <td className={cn('px-5 py-2.5 text-right num font-semibold', ratingTone)}>
        {row.rating != null ? (
          <span className="inline-flex items-center gap-1">
            <Star size={12} className={cn(ratingTone, 'fill-current opacity-40')} />
            {row.rating.toFixed(2)}
          </span>
        ) : <span className="text-muted/60">—</span>}
      </td>
      <td className="px-5 py-2.5 text-right num text-muted">
        {row.reviewsCount != null ? fmtInt(row.reviewsCount) : '—'}
      </td>
      <td className="px-5 py-2.5 text-center text-xs">
        <div className="inline-flex items-center gap-2">
          {phones.length > 0 && (
            <span title={phones.join(', ')} className="inline-flex items-center gap-0.5 text-muted">
              <Phone size={11} /> {phones.length}
            </span>
          )}
          {row.website && (
            <a href={row.website} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center text-muted hover:text-accent" title={row.website}>
              <Globe size={11} />
            </a>
          )}
          {phones.length === 0 && !row.website && <span className="text-muted/40">—</span>}
        </div>
      </td>
    </tr>
  );
}
