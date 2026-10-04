'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { QrCode } from '@/components/ui/QrCode';
import { StaffNav } from '@/components/ui/StaffNav';
import { timeHM } from '@/lib/acoustic/format';
import { api, ApiError } from '@/lib/client/api';
import { usePolling } from '@/lib/client/use-polling';
import { t } from '@/lib/i18n';
import type { ContentItem, ContentType } from '@/lib/types';

interface Overview {
  rooms: {
    table_no: number;
    phase: string;
    players: string[];
    host: string | null;
    company: { name: string; code: string } | null;
    episodeNo: number;
    mode: string | null;
    updated_at: string;
  }[];
  analytics: {
    episodesWeek: number;
    episodesTotal: number;
    companies: number;
    players: number;
    returnRate: number | null;
    returning: number;
    withAny: number;
    avgLengthMin: number | null;
    completion: number | null;
    finished: number;
    closed: number;
    byDay: { day: string; count: number }[];
  };
  content: ContentItem[];
  ai: boolean;
  model: string | null;
  pinDefault: boolean;
}

const PHASE: Record<string, string> = {
  lobby: 'лобби',
  intro: 'старт эпизода',
  warmup: 'разогрев',
  missions: 'миссии',
  vote2: 'второй круг',
  vote3: 'про повод',
  final: 'финал',
  summary: 'итог',
};
const TYPE_LABEL: Record<ContentType, string> = { question: 'вопрос', mission: 'миссия', staff_mission: 'с персоналом' };
const OCC_LABEL: Record<string, string> = { any: 'любой повод', meetup: 'встреча', birthday: 'ДР', reunion: 'вернулся', success: 'успех' };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function AdminClient({ authed: initial }: { authed: boolean }) {
  const [authed, setAuthed] = useState(initial);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [type, setType] = useState<ContentType | 'all'>('all');
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/api/admin/overview'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthed(false);
    }
  }, []);

  usePolling(load, 8000, authed);

  const login = async () => {
    setErr(null);
    try {
      await api('/api/admin/login', { body: { pin } });
      setAuthed(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const content = useMemo(() => {
    const list = data?.content ?? [];
    return list.filter((c) => (tab === 'pending' ? !c.approved : c.approved) && (type === 'all' || c.type === type));
  }, [data, tab, type]);
  const pendingCount = data?.content.filter((c) => !c.approved).length ?? 0;
  const approvedCount = data?.content.filter((c) => c.approved).length ?? 0;

  const contentAction = async (action: 'approve' | 'delete', id: string) => {
    setData((d) =>
      d
        ? {
            ...d,
            content: action === 'delete' ? d.content.filter((c) => c.id !== id) : d.content.map((c) => (c.id === id ? { ...c, approved: true } : c)),
          }
        : d,
    );
    await api('/api/admin/content', { body: { action, id } }).catch(() => load());
  };

  const generate = async () => {
    setGenerating(true);
    setGenMsg(null);
    try {
      const r = await api<{ added: number; message: string }>('/api/generate', { body: { kind: 'library' } });
      setGenMsg(r.message);
      setTab('pending');
      await load();
    } catch (e) {
      setGenMsg((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const resetTable = async (table: number) => {
    await api('/api/admin/rooms', { body: { action: 'reset', table } });
    load();
  };

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t.game.brand}</p>
        <h1 className="text-3xl font-bold">{t.admin.title}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t.admin.pin}
            className="tabular rounded-2xl border border-line bg-surface px-4 py-4 text-center text-3xl tracking-[0.5em]"
          />
          <button className="rounded-2xl bg-accent py-4 text-lg font-semibold text-accent-ink">{t.admin.login}</button>
          {err ? <p className="text-center text-bad">{err}</p> : null}
        </form>
        <Link href="/" className="text-center text-sm text-faint underline">
          ← {t.common.appName}
        </Link>
      </main>
    );
  }

  const a = data?.analytics;
  const maxDay = Math.max(1, ...(a?.byDay.map((d) => d.count) ?? [1]));

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-5 p-4 lg:p-6">
      <StaffNav title={t.admin.title} active="/admin">
        <span className={`rounded-full px-2.5 py-1 text-xs ${data?.ai ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-muted'}`}>
          AI: {data ? (data.ai ? data.model : 'нет ключа — сид') : '…'}
        </span>
      </StaffNav>
      {data?.pinDefault ? <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">⚠ {t.admin.defaultPin}</p> : null}

      {/* Аналитика */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t.admin.analytics}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={t.admin.episodesWeek} value={a ? String(a.episodesWeek) : '—'} hint={a ? `всего ${a.episodesTotal}` : ''}>
            <div className="mt-3 flex h-10 items-end gap-1" aria-label="эпизоды по дням">
              {(a?.byDay ?? []).map((d) => (
                <div
                  key={d.day}
                  title={`${new Date(d.day).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })}: ${d.count}`}
                  className="flex-1 rounded-t-[4px] bg-accent/80"
                  style={{ height: `${Math.max(6, (d.count / maxDay) * 100)}%`, opacity: d.count ? 1 : 0.25 }}
                />
              ))}
            </div>
          </Tile>
          <Tile label={t.admin.returnRate} value={pct(a?.returnRate ?? null)} hint={a ? `${a.returning} из ${a.withAny} компаний` : ''} accent />
          <Tile label={t.admin.avgLength} value={a?.avgLengthMin != null ? (a.avgLengthMin < 1 ? '< 1 мин' : `${Math.round(a.avgLengthMin)} мин`) : '—'} hint={a ? `${a.finished} доиграно` : ''} />
          <Tile label={t.admin.completion} value={pct(a?.completion ?? null)} hint={a ? `${a.finished} из ${a.closed} завершённых` : ''} />
        </div>
        {a ? (
          <p className="mt-2 text-xs text-faint">
            Компаний: {a.companies} · игроков в сезонах: {a.players}
          </p>
        ) : null}
      </section>

      {/* Активные столы */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-lg font-semibold">{t.admin.tables}</h2>
        {data?.rooms.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.rooms.map((r) => (
              <li key={r.table_no} className="flex items-start justify-between gap-3 rounded-xl bg-surface-2 p-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    Стол {r.table_no} · <span className="text-accent">{PHASE[r.phase] ?? r.phase}</span>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {r.company ? `«${r.company.name}» · ${r.company.code} · эпизод ${r.episodeNo}` : 'компания не выбрана'}
                  </p>
                  <p className="truncate text-xs text-faint">
                    {r.players.join(', ')} {r.host ? `· ведущий ${r.host}` : ''} · {timeHM(r.updated_at)}
                  </p>
                </div>
                <ConfirmButton
                  question={t.admin.resetTableConfirm}
                  onConfirm={() => resetTable(r.table_no)}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted"
                >
                  Сбросить
                </ConfirmButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">{t.admin.noTables}</p>
        )}
      </section>

      {/* Библиотека */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.admin.library}</h2>
          <button onClick={generate} disabled={generating} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60">
            {generating ? t.admin.generating : `✨ ${t.admin.generate}`}
          </button>
        </div>
        {genMsg ? <p className="mb-3 text-sm text-accent">{genMsg}</p> : null}
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {(['pending', 'approved'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 ${tab === k ? 'bg-ink text-bg' : 'bg-surface-2 text-muted'}`}>
              {k === 'pending' ? `${t.admin.pending} · ${pendingCount}` : `${t.admin.approved} · ${approvedCount}`}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          {(['all', 'question', 'mission', 'staff_mission'] as const).map((k) => (
            <button key={k} onClick={() => setType(k)} className={`rounded-full px-3 py-1.5 ${type === k ? 'bg-surface-3 text-ink' : 'text-muted'}`}>
              {k === 'all' ? 'все' : TYPE_LABEL[k]}
            </button>
          ))}
        </div>
        {content.length ? (
          <ul className="divide-y divide-line">
            {content.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">{c.text}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-muted">{TYPE_LABEL[c.type]}</span>
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-muted">{OCC_LABEL[c.occasion] ?? c.occasion}</span>
                    <span className={`rounded px-1.5 py-0.5 ${c.source === 'ai' ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-faint'}`}>{c.source === 'ai' ? 'AI' : 'сид'}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {!c.approved ? (
                    <button onClick={() => contentAction('approve', c.id)} className="rounded-lg bg-ok/20 px-2.5 py-1 text-xs font-semibold text-ok">
                      {t.admin.approve}
                    </button>
                  ) : null}
                  <button onClick={() => contentAction('delete', c.id)} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted">
                    {t.admin.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">{tab === 'pending' ? 'Нечего модерировать — нажмите «Сгенерировать 20 новых»' : 'Пусто'}</p>
        )}
      </section>

      {/* QR */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t.admin.qr}</h2>
            <p className="text-sm text-muted">Столы 1–12: QR ведёт в Table Mode, там же кнопка «Громко?».</p>
          </div>
          <Link href="/admin/qr" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg">
            🖨 {t.admin.qrOpen}
          </Link>
        </div>
        <div className="mt-4 flex gap-4 overflow-x-auto">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex shrink-0 flex-col items-center gap-1 rounded-xl bg-surface-2 p-3">
              <QrCode value={`/t/${n}`} size={96} />
              <span className="text-sm font-semibold">Стол {n}</span>
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={async () => {
          await api('/api/admin/login', { method: 'DELETE' });
          setAuthed(false);
        }}
        className="self-start text-sm text-faint underline"
      >
        Выйти из админки
      </button>
    </main>
  );
}

function Tile({ label, value, hint, accent, children }: { label: string; value: string; hint?: string; accent?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-accent/50 bg-accent-soft' : 'border-line bg-surface'}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-4xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
      {children}
    </div>
  );
}
