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
    <div className="flex items-center gap-2 bg-gradient-to-br from-good/15 to-good/5 border border-good/30 rounded-lg px-2 py-1">
      <span className="relative w-2 h-2 rounded-full bg-good pulse-dot shrink-0" />
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wider text-good font-semibold">В ТРЦ</div>
        <div className="text-sm font-bold num">
          {err ? '—' : data ? fmtInt(data.inside) : '…'}
        </div>
        <div className="text-[9px] text-muted num hidden md:block">
          {data && !err
            ? `↑${fmtInt(data.insToday)} ↓${fmtInt(data.outsToday)}${data.asOf ? ' · ' + data.asOf : ''}`
            : '…'}
        </div>
      </div>
    </div>
  );
}
