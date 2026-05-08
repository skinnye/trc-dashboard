'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader, Stat } from '@/components/Card';
import { ChartWrap } from '@/components/Chart';
import { fmtInt } from '@/lib/utils';
import { ChevronLeft, ExternalLink, Phone, Globe, MapPin, Calendar, Star } from 'lucide-react';

type Org = {
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
  longitude: number | null;
  latitude: number | null;
  categoryId: number;
  categoryName: string;
};
type HistoryPoint = {
  runId: number;
  capturedAt: string;
  rating: number | null;
  reviewsCount: number | null;
};

export default function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ org: Org; history: HistoryPoint[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/external/org/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setData)
      .catch(() => setError('Организация не найдена'));
  }, [id]);

  const phones: string[] = useMemo(() => {
    if (!data?.org.phones) return [];
    try { return JSON.parse(data.org.phones); } catch { return []; }
  }, [data]);

  const hours: Record<string, string> | null = useMemo(() => {
    if (!data?.org.hours) return null;
    try { return JSON.parse(data.org.hours); } catch { return null; }
  }, [data]);

  const ratingChart = useMemo(() => {
    if (!data || data.history.length < 2) return null;
    const labels = data.history.map(h => h.capturedAt.slice(0, 10));
    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: [{
          label: 'Рейтинг',
          data: data.history.map(h => h.rating ?? null),
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,0.1)',
          tension: 0.3,
          spanGaps: true,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 1, max: 5, ticks: { stepSize: 0.5 } },
        },
      },
    };
  }, [data]);

  const reviewsChart = useMemo(() => {
    if (!data || data.history.length < 2) return null;
    const labels = data.history.map(h => h.capturedAt.slice(0, 10));
    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: [{
          label: 'Отзывы',
          data: data.history.map(h => h.reviewsCount ?? null),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.1)',
          tension: 0.3,
          spanGaps: true,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    };
  }, [data]);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
        {data && (
          <Link
            href={`/external/${data.org.categoryId}`}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
          >
            <ChevronLeft size={14} />
            К категории «{data.org.categoryName}»
          </Link>
        )}

        {error && (
          <Card className="bg-bad/10 border-bad/30 text-bad text-sm">{error}</Card>
        )}

        {data && (
          <>
            <div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <Link href="/external" className="hover:text-accent">2GIS</Link>
                <span>·</span>
                <Link href={`/external/${data.org.categoryId}`} className="hover:text-accent">
                  {data.org.categoryName}
                </Link>
              </div>
              <h1 className="text-3xl font-bold mt-1">{data.org.name}</h1>
              {data.org.isDuplicate === 1 && (
                <span className="inline-block mt-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-warn/20 text-warn font-semibold">
                  отмечена как дубль
                </span>
              )}
            </div>

            {/* Top stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <Stat
                  label="Рейтинг"
                  value={data.org.rating != null ? data.org.rating.toFixed(2) : '—'}
                  sub={data.org.rating != null ? <span className="inline-flex items-center gap-1"><Star size={11} /> 2GIS</span> : null}
                  accent={
                    data.org.rating == null ? undefined :
                    data.org.rating >= 4.5 ? 'good' :
                    data.org.rating >= 3.5 ? 'warn' : 'bad'
                  }
                />
              </Card>
              <Card>
                <Stat
                  label="Отзывов"
                  value={data.org.reviewsCount != null ? fmtInt(data.org.reviewsCount) : '—'}
                />
              </Card>
              <Card>
                <Stat
                  label="Снапшотов"
                  value={fmtInt(data.history.length)}
                  sub="точек в истории"
                />
              </Card>
              <Card>
                <Stat
                  label="Первый раз"
                  value={data.org.firstSeenAt.slice(0, 10)}
                  sub={<>видна с</>}
                />
              </Card>
            </div>

            {/* Контакты + адрес */}
            <Card>
              <CardHeader title="Карточка" subtitle="Данные с последнего снапшота" />
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  {data.org.address && (
                    <div className="flex items-start gap-2">
                      <MapPin size={14} className="text-muted mt-0.5 shrink-0" />
                      <div>
                        <div>{data.org.address}</div>
                        {data.org.street && <div className="text-xs text-muted">{data.org.street}</div>}
                      </div>
                    </div>
                  )}
                  {phones.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Phone size={14} className="text-muted mt-0.5 shrink-0" />
                      <div className="space-y-0.5">
                        {phones.map((p, i) => <div key={i} className="num">{p}</div>)}
                      </div>
                    </div>
                  )}
                  {data.org.website && (
                    <div className="flex items-start gap-2">
                      <Globe size={14} className="text-muted mt-0.5 shrink-0" />
                      <a href={data.org.website} target="_blank" rel="noopener noreferrer"
                         className="text-accent hover:underline truncate">
                        {data.org.website}
                      </a>
                    </div>
                  )}
                  {data.org.longitude != null && data.org.latitude != null && (
                    <div className="text-xs text-muted num">
                      {data.org.latitude.toFixed(6)}, {data.org.longitude.toFixed(6)}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {hours && Object.keys(hours).length > 0 && (
                    <div className="flex items-start gap-2">
                      <Calendar size={14} className="text-muted mt-0.5 shrink-0" />
                      <div className="space-y-0.5 text-xs">
                        {Object.entries(hours).map(([d, h]) => (
                          <div key={d}><span className="text-muted">{d}: </span>{h}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.org.longitude != null && data.org.latitude != null && (
                    <a
                      href={`https://2gis.ru/ekaterinburg/firm/0?queryState=center%2F${data.org.longitude}%2C${data.org.latitude}%2Fzoom%2F18`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost inline-flex"
                    >
                      <ExternalLink size={12} />
                      На карте 2GIS
                    </a>
                  )}
                </div>
              </div>
            </Card>

            {/* Графики */}
            {data.history.length < 2 ? (
              <Card>
                <div className="text-sm text-muted text-center py-6">
                  В истории всего {data.history.length} {data.history.length === 1 ? 'точка' : 'точек'}.
                  Динамика появится после второго прогона парсера.
                </div>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title="Рейтинг во времени" subtitle="2GIS · по неделям" />
                  {ratingChart && <ChartWrap config={ratingChart} height={240} />}
                </Card>
                <Card>
                  <CardHeader title="Отзывы во времени" subtitle="накопительно" />
                  {reviewsChart && <ChartWrap config={reviewsChart} height={240} />}
                </Card>
              </div>
            )}

            {/* История точек таблицей */}
            <Card>
              <CardHeader title="История снапшотов" subtitle={`${fmtInt(data.history.length)} записей`} />
              {data.history.length === 0 ? (
                <div className="text-sm text-muted text-center py-4">Нет данных</div>
              ) : (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                        <th className="text-left  px-5 py-2 font-medium">Когда</th>
                        <th className="text-right px-5 py-2 font-medium">Рейтинг</th>
                        <th className="text-right px-5 py-2 font-medium">Отзывы</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.history].reverse().map(h => (
                        <tr key={h.runId} className="border-b border-border/50">
                          <td className="px-5 py-2 num text-muted">{h.capturedAt}</td>
                          <td className="px-5 py-2 text-right num">
                            {h.rating != null ? h.rating.toFixed(2) : '—'}
                          </td>
                          <td className="px-5 py-2 text-right num">
                            {h.reviewsCount != null ? fmtInt(h.reviewsCount) : '—'}
                          </td>
                        </tr>
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
