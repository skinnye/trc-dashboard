'use client';

import { useEffect, useState } from 'react';
import { fmtInt } from '@/lib/utils';

interface Live {
  inside: number;
  insToday: number;
  outsToday: number;
  asOf: string | null;
}

export function LiveBadge() {
  const [data, setData] = useState<Live | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const fetchIt = () => {
      fetch('/api/traffic/live')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => { setData(d); setErr(false); })
        .catch(() => setErr(true));
    };
    fetchIt();
    const id = setInterval(fetchIt, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 sm:gap-3 bg-gradient-to-br from-good/15 to-good/5 border border-good/30 rounded-xl px-2.5 sm:px-3.5 py-1.5 sm:py-2">
      <span className="relative w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-good pulse-dot shrink-0" />
      <div className="leading-tight">
        <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-good font-semibold">Сейчас в ТРЦ</div>
        <div className="text-base sm:text-lg font-bold num">
          {err ? '—' : data ? fmtInt(data.inside) : '…'}
        </div>
        <div className="text-[10px] text-muted num hidden sm:block">
          {data && !err
            ? `↑${fmtInt(data.insToday)} · ↓${fmtInt(data.outsToday)}${data.asOf ? ' · на ' + data.asOf : ''}`
            : 'загрузка…'}
        </div>
      </div>
    </div>
  );
}
