import Link from 'next/link';

import { LiveDot } from './LiveDot';

const LINKS = [
  { href: '/dashboard', label: 'Зал' },
  { href: '/admin', label: 'Table Mode' },
  { href: '/demo', label: 'Демо' },
  { href: '/book', label: 'Бронь' },
  { href: '/', label: 'Все страницы' },
];

export function StaffNav({ title, active, children }: { title: string; active?: string; children?: React.ReactNode }) {
  return (
    <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div className="flex items-center gap-3">
        <Link href="/" className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-lg font-black text-accent-ink" aria-label="На главную">
          ◖
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-widest text-faint">Зал, где слышно друг друга · Table Mode</p>
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {children}
        <nav className="flex gap-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-2.5 py-1.5 ${active === l.href ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <LiveDot />
      </div>
    </header>
  );
}
