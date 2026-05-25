'use client';

import { useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, CardHeader } from '@/components/Card';
import { Camera as CamIcon, RefreshCw, AlertTriangle } from 'lucide-react';

type Camera = { name: string; url: string };

export default function CamerasPage() {
  const [cams, setCams] = useState<Camera[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Версия для cache-busting — при нажатии «Обновить» добавляем к URL,
  // чтобы <img> перезапросил поток (некоторые MJPEG-стримы залипают).
  const [bust, setBust] = useState(0);

  useEffect(() => {
    fetch('/api/cameras')
      .then(r => r.json())
      .then(d => setCams(d.cameras ?? []))
      .catch(() => setError('Не удалось получить список камер'));
  }, []);

  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Камеры</h1>
            <p className="text-sm text-muted mt-1">
              Прямые MJPEG-потоки. Список редактируется через <code className="text-xs">POST /api/cameras</code>{' '}
              (хранение в app_settings, ключ <code className="text-xs">cameras.list</code>).
            </p>
          </div>
          <button
            onClick={() => setBust(b => b + 1)}
            className="btn-ghost"
          >
            <RefreshCw size={14} />
            Обновить
          </button>
        </div>

        {error && (
          <Card className="bg-bad/10 border-bad/30">
            <div className="flex items-start gap-3 text-sm text-bad">
              <AlertTriangle size={16} />
              {error}
            </div>
          </Card>
        )}

        {cams === null ? (
          <Card><div className="text-sm text-muted py-6 text-center">Загрузка…</div></Card>
        ) : cams.length === 0 ? (
          <Card>
            <div className="text-sm text-muted py-6 text-center">
              Камер пока нет. Добавьте через POST /api/cameras:<br />
              <code className="text-xs mt-2 inline-block">
                {`{ "cameras": [{ "name": "Главный вход", "url": "http://..." }] }`}
              </code>
            </div>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-2 gap-6">
            {cams.map((c, i) => (
              <Card key={i}>
                <CardHeader
                  title={c.name}
                  subtitle={c.url}
                  right={<CamIcon size={18} className="text-muted" />}
                />
                <div className="rounded-lg overflow-hidden bg-black border border-border">
                  {/*
                    MJPEG (multipart/x-mixed-replace) браузер играет нативно
                    через <img>. Ключ bust в src — чтобы при кнопке «Обновить»
                    создался новый img-элемент и стрим переподключился.
                  */}
                  <img
                    key={`${i}-${bust}`}
                    src={c.url + (c.url.includes('?') ? '&' : '?') + '_b=' + bust}
                    alt={c.name}
                    className="w-full h-auto block"
                    onError={() => console.warn('camera failed to load:', c.url)}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
