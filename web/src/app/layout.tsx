import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ТРЦ Академический · Дашборд',
  description: 'Аренда и трафик ТРЦ Академический',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
