/**
 * Список камер для страницы /cameras.
 *
 * Источник — app_settings, ключ 'cameras.list'. Значение — JSON-массив
 * объектов { name, url }. Хранение в БД (а не в .env) позволяет менять
 * список без рестарта и без правки файлов на каждой машине.
 */
import { getSetting, setSetting } from './db';

const SETTING_KEY = 'cameras.list';

export interface Camera {
  name: string;
  url: string;
}

export function listCameras(): Camera[] {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(c => c?.url);
    return [];
  } catch {
    return [];
  }
}

export function saveCameras(cams: Camera[]): void {
  setSetting(
    SETTING_KEY,
    JSON.stringify(cams),
    'Список камер для страницы /cameras. Формат: [{name, url}].',
  );
}
