'use client';

import { useEffect, useRef } from 'react';

export type PeopleTarget = { vx: number; vy: number; weight: number; estimated: boolean };

// Анимация «человечков»: фигурки идут от входа (низ плана) к магазинам,
// распределение по магазинам ∝ весу (число чеков; где чеков нет — оценка по ТО).
// Канвас-оверлей поверх обёртки карты; координаты viewBox пересчитываются в
// экранные с тем же translate(pan)/scale, что и CSS-трансформ карты.
export function MapPeople({
  targets, vbW, vbH, pan, scale, count,
}: {
  targets: PeopleTarget[];
  vbW: number; vbH: number;
  pan: { x: number; y: number }; scale: number;
  count: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ targets, vbW, vbH, pan, scale, count });
  propsRef.current = { targets, vbW, vbH, pan, scale, count };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;
    let raf = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    type Fig = { x: number; y: number; tx: number; ty: number; ti: number; phase: 'walk' | 'shop'; t: number; sp: number };

    function pickTarget(): number {
      const ts = propsRef.current.targets;
      const total = ts.reduce((s, t) => s + Math.max(0, t.weight), 0);
      if (total <= 0) return ts.length ? Math.floor(Math.random() * ts.length) : -1;
      let r = Math.random() * total;
      for (let i = 0; i < ts.length; i++) { r -= Math.max(0, ts[i].weight); if (r <= 0) return i; }
      return ts.length - 1;
    }
    function spawn(f: Fig) {
      const { vbW, vbH, targets } = propsRef.current;
      f.x = rand(vbW * 0.08, vbW * 0.92);
      f.y = vbH * rand(0.93, 0.99);               // вход снизу концурса
      f.ti = pickTarget();
      const t = targets[f.ti];
      f.tx = (t ? t.vx : vbW / 2) + rand(-500, 500);
      f.ty = (t ? t.vy : vbH / 2) + rand(-380, 380);
      f.phase = 'walk'; f.t = 0; f.sp = rand(90, 180);
    }
    let figs: Fig[] = [];
    function ensureCount(n: number) {
      while (figs.length < n) { const f = {} as Fig; spawn(f); const k = Math.random(); f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k; figs.push(f); }
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
        if (f.phase === 'walk') {
          const dx = f.tx - f.x, dy = f.ty - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const step = f.sp * dt;
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
  // тело
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s);
  ctx.lineTo(x + s * 0.5, y + s);
  ctx.lineTo(x + s * 0.35, y - s * 0.4);
  ctx.lineTo(x - s * 0.35, y - s * 0.4);
  ctx.closePath(); ctx.fill();
  // голова
  ctx.beginPath(); ctx.arc(x, y - s * 0.95, s * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (shopping) { // лёгкая «пульсация» у магазина
    ctx.strokeStyle = estimated ? 'rgba(251,191,36,0.4)' : 'rgba(96,165,250,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, s * 1.8, 0, Math.PI * 2); ctx.stroke();
  }
}
