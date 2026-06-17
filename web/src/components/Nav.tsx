'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Building2, Activity, LayoutGrid, Globe, History, Camera, TrendingUp, MapPinned } from 'lucide-react';

const links = [
  { href: '/',          label: 'Главная',         icon: LayoutGrid },
  { href: '/rent',      label: 'Аренда',          icon: Building2 },
  { href: '/traffic',   label: 'Трафик',          icon: Activity },
  { href: '/turnover',  label: 'Товарооборот',    icon: TrendingUp },
  { href: '/map',       label: 'Карта',           icon: MapPinned },
  { href: '/occupancy', label: 'История',         icon: History },
  { href: '/cameras',   label: 'Камеры',          icon: Camera },
  { href: '/external',  label: 'Внешний контур',  icon: Globe },
];

export function Nav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-bg/80 border-b border-border">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 h-16 flex items-center gap-3 sm:gap-6">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent2 grid place-items-center text-white font-bold shadow-glow">
            А
          </div>
          <div className="leading-tight hidden sm:block">
            <div className="text-sm font-semibold">ТРЦ Академический</div>
            <div className="text-[11px] text-muted">Дашборд</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                  active
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'text-muted hover:text-text hover:bg-surface2',
                )}
              >
                <Icon size={16} />
                <span className="hidden xs:inline sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <div className="shrink-0">{right}</div>
      </div>
    </header>
  );
}
