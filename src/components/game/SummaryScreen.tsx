'use client';

import confetti from 'canvas-confetti';
import { useEffect, useState } from 'react';

import { HeardQuestion } from '@/components/hall/HeardQuestion';
import { useOrigin } from '@/components/ui/QrCode';
import { fmt, t } from '@/lib/i18n';

import { useGame } from './context';
import { BigButton, Screen } from './ui';

const AI_WAIT_MS = 15_000;

export function SummaryScreen() {
  const { state, act, busy, isHost, table, zone, now } = useGame();
  const s = state.summary;
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const colors = ['#f59e4c', '#f6ece2', '#d55181', '#3987e5', '#c98500'];
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.3 }, colors, disableForReducedMotion: true });
    const id = setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { y: 0.2 }, colors, disableForReducedMotion: true }), 700);
    return () => clearTimeout(id);
  }, []);

  if (!s || !state.company) return null;
  const c = state.company;
  const waitingAi = s.source === 'pending' && now - s.since < AI_WAIT_MS;
  const shareUrl = `${origin}/t/${table}`;
  const shareText = [
    `Table Mode · «${c.name}», эпизод ${state.episodeNo}.`,
    s.mvpName ? `MVP: ${s.mvpName}.` : '',
    s.quote ? `Фраза вечера: «${s.quote.text}».` : '',
    waitingAi ? '' : s.text,
    `Код сезона: ${c.code}`,
  ]
    .filter(Boolean)
    .join(' ');

  const nativeShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Table Mode', text: shareText, url: shareUrl });
      else {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
        setCopied(true);
      }
    } catch {
      /* пользователь закрыл окно */
    }
  };

  return (
    <Screen kicker={`${t.game.summary} · ${fmt(t.game.episode, { n: state.episodeNo })}`} title={c.name}>
      <div className="grid grid-cols-2 gap-3">
        <div className="animate-pop rounded-3xl border border-accent/50 bg-accent-soft p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted">{t.game.mvp}</p>
          <p className="mt-1 text-3xl" aria-hidden>
            👑
          </p>
          <p className="mt-1 text-xl font-bold leading-tight">{s.mvpName ?? '—'}</p>
          {s.mvpId ? (
            <p className="tabular text-sm text-muted">
              {state.points[s.mvpId] ?? 0} {t.game.points}
            </p>
          ) : null}
        </div>
        <div className="animate-pop rounded-3xl border border-line bg-surface p-4" style={{ animationDelay: '120ms' }}>
          <p className="text-xs uppercase tracking-widest text-muted">{t.game.quoteOfNight}</p>
          {s.quote ? (
            <>
              <p className="mt-2 leading-snug font-semibold">«{s.quote.text}»</p>
              <p className="mt-1 text-sm text-muted">— {s.quote.by}</p>
            </>
          ) : (
            <p className="mt-2 text-faint">—</p>
          )}
        </div>
      </div>

      <div className="rounded-3xl bg-surface-2 p-5">
        {waitingAi ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">✨ {t.game.aiWriting}</p>
            <div className="skeleton h-4 rounded" />
            <div className="skeleton h-4 w-11/12 rounded" />
            <div className="skeleton h-4 w-3/4 rounded" />
          </div>
        ) : (
          <p className="animate-fade-in text-lg leading-relaxed">{s.text}</p>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">
          {t.game.seasonTable} «{c.season}»
        </p>
        <ol className="space-y-1.5">
          {s.season.map((r, i) => (
            <li key={r.memberId} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2">
              <span className="tabular w-5 text-center text-faint">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{r.name}</span>
              {r.gained ? <span className="tabular text-sm text-ok">+{r.gained}</span> : null}
              <span className="tabular w-10 text-right font-bold">{r.total}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-3xl border border-accent/40 bg-accent-soft p-5 text-center">
        <p className="text-sm text-muted">{t.game.code}</p>
        <p className="tabular my-1 font-mono text-5xl font-black tracking-[0.3em] text-accent">{c.code}</p>
        <p className="text-sm text-muted">{t.game.rememberCode}</p>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-semibold">{t.game.share}</p>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl bg-[#229ed9] px-4 py-3.5 text-center font-semibold text-white"
          >
            Telegram
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl bg-[#25d366] px-4 py-3.5 text-center font-semibold text-[#062a14]"
          >
            WhatsApp
          </a>
        </div>
        <button onClick={nativeShare} className="text-sm text-muted underline">
          {copied ? 'Скопировано ✓' : 'Другое приложение / скопировать'}
        </button>
      </div>

      <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-center text-muted">
        🔓 {fmt(t.game.teaser, { n: state.episodeNo + 1, mode: s.teaser })}
      </p>

      <div className="rounded-3xl border border-line bg-surface p-5 text-center">
        <HeardQuestion zone={zone} table={table} />
      </div>

      {isHost ? (
        <BigButton variant="secondary" onClick={() => act({ type: 'reset' })} disabled={busy}>
          ↺ {t.game.newGame}
        </BigButton>
      ) : null}
    </Screen>
  );
}
