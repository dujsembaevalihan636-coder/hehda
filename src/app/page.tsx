import Link from 'next/link';
import { connection } from 'next/server';

import { DATA_MODE } from '@/lib/config';
import { aiEnabled, serverEnv } from '@/lib/server/env';

// Главная: все точки входа обоих модулей на одной странице (удобно на хакатоне).

const HALL = [
  { href: '/dashboard', title: 'Панель менеджера', text: 'Схема зала, графики 15 минут, лента решений, алерты, ручное управление' },
  { href: '/book', title: 'Бронь стола', text: 'Выбор атмосферы и живая карта шума «как пробки»' },
  { href: '/sensor?zone=A', title: 'Датчик (телефон)', text: 'Только число в дБ — звук не записывается', extra: [['B', '/sensor?zone=B'], ['C', '/sensor?zone=C']] },
  { href: '/player?zone=A', title: 'Колонки зоны (ноутбук)', text: 'Музыка зоны: громкость за 3 с, темп кроссфейдом', extra: [['B', '/player?zone=B'], ['C', '/player?zone=C']] },
  { href: '/table?zone=A&t=5', title: '«Громко?» со стола', text: 'Одна кнопка — музыка в зоне сразу тише' },
  { href: '/feedback?zone=A', title: '«Было слышно?»', text: 'Послевизитный вопрос: да / нет' },
];

const GAME = [
  { href: '/t/7', title: 'Стол 7 — играть', text: 'QR на столе → общая комната → эпизод сезона вашей компании' },
  { href: '/admin', title: 'Админка Table Mode', text: 'Столы, библиотека с AI-генерацией, аналитика возврата (PIN)' },
  { href: '/admin/qr', title: 'QR-карточки A4', text: 'Столы 1–12 для печати' },
];

export default async function Home() {
  await connection();
  const ai = aiEnabled();
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-8 lg:py-12">
      <header className="flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">MVP для хакатона</p>
          <h1 className="mt-2 text-4xl font-bold leading-tight lg:text-5xl">
            Зал, где слышно друг друга
            <span className="text-muted"> + Table Mode</span>
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">
            Ресторан держит комфортный шум по зонам — музыка сама подстраивается под разговоры. А за столом компания играет в «эпизод» своего сезона:
            телефон — пульт, а не экран.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/demo" className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            ▶︎ Демо для питча
          </Link>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-muted">
            Данные: <b className="text-ink">{DATA_MODE === 'supabase' ? 'Supabase' : 'локальный режим'}</b>
          </span>
          <span className={`rounded-full px-3 py-1 ${ai ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}`}>
            AI: {ai ? serverEnv.anthropicModel : 'нет ключа — работает на сиде'}
          </span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Module title="🔊 Зал: акустические зоны" subtitle="A «Поговорить» 60–65 дБ · B «Фон» 65–72 · C «Движ» 72–80" items={HALL} />
        <Module title="🎲 Table Mode: игра за столом" subtitle="Разогрев · секретные миссии · финал · итог и код сезона" items={GAME} />
      </div>

      <footer className="text-sm text-faint">
        Приватность: звук никогда не записывается и не отправляется — телефон считает только громкость (одно число в дБ).
      </footer>
    </main>
  );
}

function Module({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: { href: string; title: string; text: string; extra?: string[][] }[];
}) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <ul className="mt-4 grid gap-2">
        {items.map((i) => (
          <li key={i.href} className="flex items-center gap-2">
            <Link href={i.href} className="group flex-1 rounded-2xl bg-surface-2 px-4 py-3 transition hover:bg-surface-3">
              <span className="font-semibold group-hover:text-accent">{i.title} →</span>
              <span className="block text-sm text-muted">{i.text}</span>
            </Link>
            {i.extra?.map(([label, href]) => (
              <Link key={href} href={href} className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 font-semibold text-muted hover:text-ink">
                {label}
              </Link>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
