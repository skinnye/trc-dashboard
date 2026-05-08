'use client';

/**
 * Тепловая карта на Яндекс.Картах (ymaps 2.1) + heatmap-плагин.
 *
 * Раньше использовали Leaflet + leaflet.heat поверх OpenStreetMap. Заменили
 * на Яндекс ради привычной русскоязычной картографии и поскольку у нас уже
 * есть API-ключ. Yandex Maps требует использования их JS API (не raw tiles),
 * поэтому код подгружает ymaps скриптом и инициализирует карту через него.
 *
 * Ключ читается из app_settings (key='yandex.maps_api_key') через
 * /api/external/maps-key — не зашит в код, не лежит в .env.
 */
import { useEffect, useRef, useState } from 'react';

export interface HeatPoint {
  lat: number;
  lng: number;
  // Вес точки. По умолчанию 1.0.
  weight?: number;
  name?: string;
  category?: string;
}

interface Props {
  points: HeatPoint[];
  // Центр карты — по умолчанию ТРЦ Академический.
  center?: [number, number];
  zoom?: number;
  height?: number;
  // radius/intensity — параметры heatmap-плагина Яндекса.
  // radius (px): размер пятна каждой точки.
  // dissipating: затухание с увеличением зума.
  // opacity: общая прозрачность слоя.
  // intensityOfMidpoint: позиция цвета середины градиента (0..1).
  radius?: number;
  opacity?: number;
}

const DEFAULT_CENTER: [number, number] = [56.789, 60.530];
const DEFAULT_ZOOM = 13;
const YMAPS_VERSION = '2.1';
// Плагин теплокарты Яндекса. Раньше тянули с yandex.github.io/mapsapi-heatmap,
// но GitHub Pages там отключили (404). Скачали файл в public/vendor/, сервим
// сами — заодно работает в офлайне и не зависит от стороннего хоста.
const HEATMAP_PLUGIN_URL = '/vendor/yandex-heatmap.min.js';

// Singleton-загрузчик: ymaps подгружаем один раз на страницу, чтобы при
// размонтировании/маунте компонента не дублировать <script>-ы.
let _ymapsPromise: Promise<unknown> | null = null;

async function loadYmaps(): Promise<unknown> {
  if (_ymapsPromise) return _ymapsPromise;
  _ymapsPromise = (async () => {
    // Берём ключ из настроек.
    const r = await fetch('/api/external/maps-key');
    if (!r.ok) throw new Error('Не настроен ключ Яндекс.Карт (app_settings.yandex.maps_api_key)');
    const { key } = await r.json();

    // Подгружаем сам ymaps API.
    await injectScript(
      `https://api-maps.yandex.ru/${YMAPS_VERSION}/?apikey=${encodeURIComponent(key)}&lang=ru_RU`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ymaps = (window as any).ymaps;
    if (!ymaps) throw new Error('ymaps не инициализировался');

    // Дожидаемся готовности.
    await new Promise<void>(resolve => ymaps.ready(resolve));

    // Подгружаем плагин heatmap (внешний модуль yandex/mapsapi-heatmap).
    // Регистрируем его в системе модулей ymaps вручную.
    await injectScript(HEATMAP_PLUGIN_URL);

    return ymaps;
  })();
  return _ymapsPromise;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if ((existing as HTMLScriptElement).dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(s);
  });
}

export default function Heatmap({
  points,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  height = 500,
  radius = 18,
  opacity = 0.7,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ymapsRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Создаём карту один раз. Слой heatmap пересоздаётся отдельным эффектом
  // при каждом изменении точек/настроек — это обходит баги с ленивой
  // перерисовкой плагина.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const ymaps = await loadYmaps();
        if (cancelled || !containerRef.current) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Y = ymaps as any;
        // Регистрируем модуль heatmap (плагин подгрузил его как ymaps.Heatmap,
        // но нам надо подождать готовности).
        await new Promise<void>(resolve => Y.ready(['Heatmap'], resolve));

        const map = new Y.Map(containerRef.current, {
          center,
          zoom,
          controls: ['zoomControl', 'typeSelector'],
        });

        ymapsRef.current = Y;
        mapRef.current = map;
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
        heatRef.current = null;
        ymapsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пересоздаём heatmap-слой при изменении точек/настроек.
  useEffect(() => {
    if (!ready || !mapRef.current || !ymapsRef.current) return;
    const Y = ymapsRef.current;
    const map = mapRef.current;

    if (heatRef.current) {
      // Yandex heatmap-плагин добавляется в карту через setMap(map),
      // а не через map.geoObjects.add. Поэтому снимать его надо тоже
      // через setMap(null) — geoObjects.remove() в этом случае no-op,
      // и старый слой остаётся на карте, накладываясь поверх нового.
      heatRef.current.setMap(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dest = (heatRef.current as any).destroy;
      if (typeof dest === 'function') (heatRef.current as { destroy: () => void }).destroy();
      heatRef.current = null;
    }

    if (points.length === 0) return;

    // Yandex Heatmap принимает GeoObject-collection-like структуру.
    // Используем formal GeoJSON-like с координатами в порядке Яндекса
    // [lat, lng] и весом в properties.weight.
    const features = points
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lat, p.lng] },
        properties: { weight: p.weight ?? 1 },
      }));

    if (features.length === 0) return;

    const heatmap = new Y.Heatmap(features, {
      radius,
      dissipating: false,
      opacity,
      intensityOfMidpoint: 0.2,
      gradient: {
        0.1: 'rgba(59,130,246,0.7)',   // синий
        0.3: 'rgba(34,197,94,0.7)',    // зелёный
        0.5: 'rgba(234,179,8,0.8)',    // жёлтый
        0.7: 'rgba(249,115,22,0.85)',  // оранжевый
        1.0: 'rgba(239,68,68,0.95)',   // красный
      },
    });
    heatmap.setMap(map);
    heatRef.current = heatmap;

    // Если точек немного — подгоняем зум, чтобы их кластер был виден.
    if (features.length > 0 && features.length < 200) {
      const lats = features.map(f => f.geometry.coordinates[0]);
      const lngs = features.map(f => f.geometry.coordinates[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 }).then(() => {
        // setBounds возвращает Promise — внутри ничего больше не делаем.
      }).catch(() => {});
    }
  }, [points, radius, opacity, ready]);

  if (error) {
    return (
      <div
        style={{ height, width: '100%' }}
        className="rounded-lg border border-bad/30 bg-bad/5 grid place-items-center text-sm text-bad px-4 text-center"
      >
        Карта не загрузилась: {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden border border-border"
    />
  );
}
