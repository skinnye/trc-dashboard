'use client';

import { useEffect, useRef } from 'react';

export type PeopleTarget = { vx: number; vy: number; weight: number; estimated: boolean };
type Pt = [number, number];

// Анимация «человечков»: фигурки идут к магазинам, распределение ∝ весу (число
// чеков; где нет — оценка по ТО). Если нарисованы пути (коридоры) — идут вдоль
// ближайшего к магазину пути, затем сворачивают к нему; иначе по прямой.
export function MapPeople({
  targets, paths, vbW, vbH, pan, scale, count,
}: {
  targets: PeopleTarget[];
  paths: Pt[][];
  vbW: number; vbH: number;
  pan: { x: number; y: number }; scale: number;
  count: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ targets, paths, vbW, vbH, pan, scale, count });
  propsRef.current = { targets, paths, vbW, vbH, pan, scale, count };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;
    let raf = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const d2 = (ax: number, ay: number, bx: number, by: number) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
    function nearestIdx(pts: Pt[], x: number, y: number) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = d2(pts[i][0], pts[i][1], x, y); if (d < bd) { bd = d; bi = i; } }
      return { idx: bi, d: bd };
    }

    type Fig = { x: number; y: number; tx: number; ty: number; ti: number; phase: 'route' | 'walk' | 'shop'; t: number; sp: number; route: Pt[] | null; seg: number; exit: number };

    function pickTarget(): number {
      const ts = propsRef.current.targets;
      const total = ts.reduce((s, t) => s + Math.max(0, t.weight), 0);
      if (total <= 0) return ts.length ? Math.floor(Math.random() * ts.length) : -1;
      let r = Math.random() * total;
      for (let i = 0; i < ts.length; i++) { r -= Math.max(0, ts[i].weight); if (r <= 0) return i; }
      return ts.length - 1;
    }
    function spawn(f: Fig) {
      const { vbW, vbH, targets, paths } = propsRef.current;
      f.ti = pickTarget();
      const t = targets[f.ti];
      const tx0 = t ? t.vx : vbW / 2, ty0 = t ? t.vy : vbH / 2;
      f.tx = tx0 + rand(-450, 450); f.ty = ty0 + rand(-340, 340);
      f.t = 0;
      // выбрать путь с ближайшей к цели точкой
      let best: Pt[] | null = null, bestD = Infinity, bestExit = 0;
      for (const p of paths || []) {
        if (!p || p.length < 2) continue;
        const ni = nearestIdx(p, tx0, ty0);
        if (ni.d < bestD) { bestD = ni.d; best = p; bestExit = ni.idx; }
      }
      if (best) {
        // входим с конца, более далёкого от цели → идём вдоль коридора к выходу
        const d0 = d2(best[0][0], best[0][1], tx0, ty0);
        const dn = d2(best[best.length - 1][0], best[best.length - 1][1], tx0, ty0);
        const route = d0 >= dn ? best : best.slice().reverse();
        const exit = Math.max(1, d0 >= dn ? bestExit : best.length - 1 - bestExit);
        f.route = route; f.exit = exit;
        f.seg = Math.floor(rand(0, exit));            // распределить вдоль коридора
        f.x = route[f.seg][0] + rand(-120, 120); f.y = route[f.seg][1] + rand(-120, 120);
        f.phase = 'route'; f.sp = rand(120, 230);
        return;
      }
      // без путей — по прямой от входа снизу, со случайным смещением вдоль маршрута
      f.route = null; f.phase = 'walk'; f.sp = rand(90, 180);
      f.x = rand(vbW * 0.08, vbW * 0.92); f.y = vbH * rand(0.93, 0.99);
      const k = Math.random(); f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k;
    }
    let figs: Fig[] = [];
    function ensureCount(n: number) {
      while (figs.length < n) { const f = {} as Fig; spawn(f); figs.push(f); }
      if (figs.length > n) figs.length = n;
    }
    ensureCount(propsRef.current.count);

    let last = performance.now();
    function frame(now: number) {
      const dt = Math.min(50, now - last) / 16.67; last = now;
      const { vbW, vbH, pan, scale, targets, count } = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ensureCount(count);

      const sx = (vx: number) => (vx / vbW * W) * scale + pan.x;
      const sy = (vy: number) => (vy / vbH * H) * scale + pan.y;

      for (const f of figs) {
        const step = f.sp * dt;
        if (f.phase === 'route' && f.route) {
          const tgt = f.route[f.seg + 1] ?? f.route[f.route.length - 1];
          const dx = tgt[0] - f.x, dy = tgt[1] - f.y; const d = Math.hypot(dx, dy) || 1;
          if (d < step) {
            f.x = tgt[0]; f.y = tgt[1]; f.seg++;
            if (f.seg >= f.exit || f.seg >= f.route.length - 1) f.phase = 'walk';   // сворачиваем к магазину
          } else { f.x += dx / d * step; f.y += dy / d * step; }
        } else if (f.phase === 'walk') {
          const dx = f.tx - f.x, dy = f.ty - f.y; const d = Math.hypot(dx, dy) || 1;
          if (d < step) { f.x = f.tx; f.y = f.ty; f.phase = 'shop'; f.t = rand(25, 70); }
          else { f.x += dx / d * step; f.y += dy / d * step; }
        } else {
          f.t -= dt; if (f.t <= 0) spawn(f);
        }
        const px = sx(f.x), py = sy(f.y);
        if (px < -24 || py < -24 || px > W + 24 || py > H + 24) continue;
        drawPerson(ctx, px, py, scale, !!targets[f.ti]?.estimated, f.phase === 'shop');
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />;
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, estimated: boolean, shopping: boolean) {
  const s = Math.max(3.2, 5.2 * Math.min(1.8, scale));
  const col = estimated ? 'rgba(251,191,36,0.9)' : 'rgba(96,165,250,0.95)';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s);
  ctx.lineTo(x + s * 0.5, y + s);
  ctx.lineTo(x + s * 0.35, y - s * 0.4);
  ctx.lineTo(x - s * 0.35, y - s * 0.4);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - s * 0.95, s * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (shopping) {
    ctx.strokeStyle = estimated ? 'rgba(251,191,36,0.4)' : 'rgba(96,165,250,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, s * 1.8, 0, Math.PI * 2); ctx.stroke();
  }
}
