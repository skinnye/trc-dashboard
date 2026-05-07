import { cn } from '@/lib/utils';

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }: {
  title: string; subtitle?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  accent?: 'good' | 'warn' | 'bad' | 'accent';
}) {
  const colors: Record<string, string> = {
    good:   'text-good',
    warn:   'text-warn',
    bad:    'text-bad',
    accent: 'text-accent',
  };
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className={cn('text-2xl font-bold num leading-tight', accent && colors[accent])}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted num">{sub}</div>}
    </div>
  );
}
