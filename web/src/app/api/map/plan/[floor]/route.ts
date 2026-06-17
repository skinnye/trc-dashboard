import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// Отдаёт SVG-подложку этажа из ../floorplans/{floor}.svg (рядом с проектом).
export async function GET(_req: Request, ctx: { params: Promise<{ floor: string }> }) {
  const { floor } = await ctx.params;
  if (!/^[1-9]$/.test(floor)) {
    return NextResponse.json({ error: 'bad floor' }, { status: 400 });
  }
  try {
    const file = path.join(process.cwd(), '..', 'floorplans', `${floor}.svg`);
    const svg = await readFile(file, 'utf-8');
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'план этажа не найден' }, { status: 404 });
  }
}
