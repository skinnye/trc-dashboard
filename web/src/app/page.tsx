import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { LiveBadge } from '@/components/LiveBadge';
import { Building2, Activity, ArrowRight, TrendingUp, Users, Target } from 'lucide-react';

export default function Home() {
  return (
    <>
      <Nav right={<LiveBadge />} />
      <main className="max-w-[1600px] mx-auto px-6 py-10">
        <div className="mb-10">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-text to-muted bg-clip-text text-transparent">
            Единый дашборд ТРЦ&nbsp;Академический
          </h1>
          <p className="text-muted mt-3 max-w-2xl">
            Аналитика арендных платежей и посещаемости в реальном времени.
            Один источник, два среза — выбери что смотреть.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-5xl">
          <Link href="/rent" className="group card card-hover block p-7 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent2 grid place-items-center shadow-glow">
                  <Building2 size={28} className="text-white" />
                </div>
                <ArrowRight size={20} className="text-muted group-hover:text-accent transition-colors translate-x-0 group-hover:translate-x-1 duration-200" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Аренда</h2>
              <p className="text-muted text-sm mb-6">
                План/факт по Юр.Лицам, платёжная дисциплина, отклонения по месяцам
                и&nbsp;недополученная выгода по&nbsp;несданным помещениям.
              </p>
              <div className="flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><TrendingUp size={14} />План/Факт</span>
                <span className="flex items-center gap-1.5"><Target size={14} />Отклонения</span>
                <span className="flex items-center gap-1.5"><Users size={14} />Дисциплина</span>
              </div>
            </div>
          </Link>

          <Link href="/traffic" className="group card card-hover block p-7 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-good/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-start justify-between mb-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-good to-f4 grid place-items-center shadow-glow">
                  <Activity size={28} className="text-white" />
                </div>
                <ArrowRight size={20} className="text-muted group-hover:text-good transition-colors translate-x-0 group-hover:translate-x-1 duration-200" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Трафик</h2>
              <p className="text-muted text-sm mb-6">
                Посетители по этажам, часам и месяцам. Счётчик «сейчас в ТРЦ»
                в реальном времени. Сравнение с прошлым годом.
              </p>
              <div className="flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><Users size={14} />По этажам</span>
                <span className="flex items-center gap-1.5"><Activity size={14} />По часам</span>
                <span className="flex items-center gap-1.5"><TrendingUp size={14} />По месяцам</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </>
  );
}
