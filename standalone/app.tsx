'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';

import AdminPage from '@/app/admin/page';
import QrPage from '@/app/admin/qr/page';
import BookPage from '@/app/book/page';
import DashboardPage from '@/app/dashboard/page';
import DemoHallPage from '@/app/demo/hall/page';
import DemoHub from '@/app/demo/page';
import DemoTablePage from '@/app/demo/table/page';
import FeedbackPage from '@/app/feedback/page';
import Home from '@/app/page';
import PlayerPage from '@/app/player/page';
import SensorPage from '@/app/sensor/page';
import TableModePage from '@/app/t/[table]/page';
import TablePage from '@/app/table/page';
import { ConfirmButton } from '@/components/ui/ConfirmButton';

import { navigate, toToken, useLocation, type Loc } from './router';
import { HTML_MODE, toast } from './runtime';
import { NotFoundSignal, RedirectSignal } from './shims/next-navigation';
import { resetDemo, setSensorsEnabled, useSensorsEnabled } from './virtual-hall';

// Оболочка HTML-версии: те же страницы приложения, роутер по #якорям и панель демо сверху.

type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
};
type PageFn = (props: PageProps) => ReactNode | Promise<ReactNode>;

const page = (fn: unknown) => fn as PageFn;

// [шаблон пути, страница, имена параметров по группам шаблона]
const PAGES: [RegExp, PageFn, string[]?][] = [
  [/^\/$/, page(Home)],
  [/^\/dashboard$/, page(DashboardPage)],
  [/^\/book$/, page(BookPage)],
  [/^\/sensor$/, page(SensorPage)],
  [/^\/player$/, page(PlayerPage)],
  [/^\/table$/, page(TablePage)],
  [/^\/feedback$/, page(FeedbackPage)],
  [/^\/demo$/, page(DemoHub)],
  [/^\/demo\/hall$/, page(DemoHallPage)],
  [/^\/demo\/table$/, page(DemoTablePage)],
  [/^\/t\/([^/]+)$/, page(TableModePage), ['table']],
  [/^\/admin$/, page(AdminPage)],
  [/^\/admin\/qr$/, page(QrPage)],
];

function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <p className="text-6xl font-black text-accent">404</p>
      <p className="text-muted">Такой страницы нет.</p>
      <button onClick={() => navigate('/')} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
        На главную
      </button>
    </main>
  );
}

function PageError({ error }: { error: unknown }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <p className="text-lg font-semibold">Страница не открылась</p>
      <p className="break-words text-sm text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <button onClick={() => navigate('/')} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
        На главную
      </button>
    </main>
  );
}

/** Серверные страницы Next.js — обычные async-функции: вызываем их здесь и рисуем результат. */
function RouteView({ loc }: { loc: Loc }) {
  const key = toToken(loc);
  const [view, setView] = useState<{ key: string; node: ReactNode } | null>(null);

  useEffect(() => {
    let alive = true;
    const match = PAGES.find(([re]) => re.test(loc.path));
    const show = (node: ReactNode) => {
      if (alive) setView({ key, node });
    };
    if (!match) {
      queueMicrotask(() => show(<NotFound />));
    } else {
      const [re, fn, names = []] = match;
      const groups = re.exec(loc.path) ?? [];
      const params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(groups[i + 1] ?? '')]));
      Promise.resolve()
        .then(() => fn({ params: Promise.resolve(params), searchParams: Promise.resolve({ ...loc.query }) }))
        .then(show)
        .catch((e: unknown) => {
          if (!alive) return;
          if (e instanceof RedirectSignal) navigate(e.to);
          else if (e instanceof NotFoundSignal) show(<NotFound />);
          else {
            console.error(e);
            show(<PageError error={e} />);
          }
        });
    }
    return () => {
      alive = false;
    };
  }, [key, loc]);

  if (!view) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="skeleton h-40 rounded-3xl" />
      </div>
    );
  }
  return <Fragment key={view.key}>{view.node}</Fragment>;
}

function routeNote(loc: Loc): string | null {
  if (loc.path === '/sensor') {
    return HTML_MODE === 'artifact'
      ? 'В превью микрофон недоступен, поэтому зоны слушают виртуальные датчики. Настоящий датчик — /sensor на телефоне в запущенном приложении или в HTML-файле на компьютере.'
      : 'Браузер спросит доступ к микрофону. Чтобы зону слушал только ваш микрофон, выключите виртуальные датчики кнопкой выше.';
  }
  if (loc.path === '/admin' || loc.path === '/admin/qr') return 'PIN для демо: 1234';
  if (loc.path === '/player') return 'Музыка синтезируется прямо в браузере: нажмите «Включить музыку зоны» — громкость и темп меняет алгоритм.';
  return null;
}

function DemoBar({ loc, onReset }: { loc: Loc; onReset: () => Promise<void> }) {
  const sensors = useSensorsEnabled();
  const note = routeNote(loc);
  return (
    <div className="no-print border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <button
          onClick={() => navigate('/')}
          className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-accent"
          title="На главную"
        >
          HTML-демо
        </button>
        <p className="hidden min-w-0 flex-1 text-muted sm:block">
          Сервер, база и датчики работают прямо в этой вкладке. <span className="text-faint">Данные хранятся только в вашем браузере.</span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => void setSensorsEnabled(!sensors)}
            aria-pressed={sensors}
            aria-label="Виртуальные датчики"
            className="flex items-center gap-2 rounded-full border border-line px-3 py-1 hover:border-accent"
          >
            <span className={`h-2 w-2 rounded-full ${sensors ? 'animate-pulse bg-ok' : 'bg-faint'}`} aria-hidden />
            <span>
              <span className="hidden sm:inline">Виртуальные датчики</span>
              <span className="sm:hidden">Датчики</span>: {sensors ? 'вкл' : 'выкл'}
            </span>
          </button>
          <ConfirmButton question="Стереть все демо-данные?" onConfirm={onReset} className="rounded-full border border-line px-3 py-1 text-muted hover:text-ink">
            ↺ <span className="hidden sm:inline">Сбросить демо</span>
            <span className="sm:hidden">Сброс</span>
          </ConfirmButton>
        </div>
      </div>
      {note ? <p className="mx-auto max-w-[1700px] px-4 pb-2 text-xs text-warn">{note}</p> : null}
    </div>
  );
}

function Toasts() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setText(null), 5000);
    };
    window.addEventListener('hehda:toast', onToast);
    return () => {
      window.removeEventListener('hehda:toast', onToast);
      clearTimeout(timer);
    };
  }, []);
  if (!text) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 mx-auto w-fit max-w-[calc(100%-2rem)] animate-pop rounded-full bg-ink px-5 py-2.5 text-center text-sm font-medium text-bg shadow-xl"
    >
      {text}
    </div>
  );
}

export function App() {
  const loc = useLocation();
  const [epoch, setEpoch] = useState(0);

  const reset = async () => {
    await resetDemo();
    setEpoch((e) => e + 1);
    navigate('/');
    toast('Демо-данные сброшены: зал и столы начинают вечер заново');
  };

  return (
    <>
      <DemoBar loc={loc} onReset={reset} />
      <RouteView key={epoch} loc={loc} />
      <Toasts />
    </>
  );
}
