import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Возвращает только публичный API-ключ Яндекс.Карт. Это безопасно
// раскрывать клиенту: ключ ограничен по HTTP-referrer'у в кабинете
// Яндекс.Карт. Никаких других секретов через этот эндпоинт не уходит.
export async function GET() {
  const key = getSetting('yandex.maps_api_key');
  if (!key) return NextResponse.json({ error: 'no key configured' }, { status: 404 });
  return NextResponse.json({ key });
}
