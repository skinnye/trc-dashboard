'use client';

import { useEffect, useRef } from 'react';
import {
  Chart, CategoryScale, LinearScale,
  LineController, BarController,
  BarElement, LineElement, PointElement,
  Tooltip, Legend, Title, Filler,
  type ChartConfiguration,
} from 'chart.js';

Chart.register(
  CategoryScale, LinearScale,
  LineController, BarController,
  BarElement, LineElement, PointElement,
  Tooltip, Legend, Title, Filler,
);

Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#263041';
Chart.defaults.font.family = 'Inter, -apple-system, Segoe UI, sans-serif';

export function ChartWrap({ config, height = 300 }: { config: ChartConfiguration; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const instRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    instRef.current?.destroy();
    instRef.current = new Chart(ref.current, config);
    return () => { instRef.current?.destroy(); instRef.current = null; };
  }, [config]);

  return <div style={{ height }}><canvas ref={ref} /></div>;
}
