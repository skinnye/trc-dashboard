import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: ClassValue[]) {
  return twMerge(clsx(classes));
}

export const fmtInt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU');

export const fmtRub = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export const fmtPct = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`;

export const fmtShort = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)} тыс`;
  return Math.round(n).toString();
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const daysAgoIso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export const MONTH_NAMES_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

export const MONTH_NAMES_FULL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
