import type { Metadata } from 'next';
import Link from 'next/link';

import { StaffNav } from '@/components/ui/StaffNav';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Демо для питча' };

const CARDS = [
  {
    href: '/demo/hall',
    title: t.demo.hall,
    text: t.demo.hallHint,
    steps: ['Ноутбук: открыть эту страницу и включить музыку', 'Телефон: отсканировать QR → «Запустить датчик»', 'Громко поговорить — музыка тише и медленнее', 'Нет сети? «Симуляция пятницы» работает офлайн'],
  },
  {
    href: '/demo/table',
    title: t.demo.table,
    text: t.demo.tableHint,
    steps: ['Четыре «телефона» входят за стол 7', 'Ведущий выбирает компанию, повод и длину', '«Симулировать голоса» — проходит раунды за секунды', 'Итог эпизода и код компании для следующего визита'],
  },
];

export default function DemoHub() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 p-4 lg:p-8">
      <StaffNav title={t.demo.hub} active="/demo" />
      <div className="grid gap-5 md:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-3xl border border-line bg-surface p-6 transition hover:border-accent">
            <h2 className="text-2xl font-semibold group-hover:text-accent">{c.title} →</h2>
            <p className="mt-2 text-muted">{c.text}</p>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink/85">
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Link>
        ))}
      </div>
    </main>
  );
}
