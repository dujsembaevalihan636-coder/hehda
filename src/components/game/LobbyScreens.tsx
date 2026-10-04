'use client';

import { useState } from 'react';

import { HOST_CLAIM_MS } from '@/lib/game/types';
import { fmt, t } from '@/lib/i18n';
import type { EpisodeMode, Occasion } from '@/lib/types';

import { nameOf, useGame } from './context';
import { Avatar, BigButton, HostBar, Screen } from './ui';

const OCCASIONS: { id: Occasion; icon: string }[] = [
  { id: 'meetup', icon: '🥂' },
  { id: 'birthday', icon: '🎂' },
  { id: 'reunion', icon: '🧳' },
  { id: 'success', icon: '🏆' },
];

export function PlayersStrip() {
  const { state } = useGame();
  return (
    <div>
      <p className="mb-2 text-sm text-muted">
        {t.game.players} · {state.players.length}
      </p>
      <div className="flex flex-wrap gap-3">
        {state.players.map((p) => (
          <span key={p.id} className="flex animate-pop items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1">
            <Avatar player={p} size={30} />
            <span className="text-sm">{p.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function LobbyWaiting() {
  const { state, host, now, act } = useGame();
  const hostAway = host ? now - host.lastSeen > HOST_CLAIM_MS : true;
  return (
    <Screen kicker={t.game.brand} title={fmt(t.game.lobbyWait, { host: host?.name ?? '…' })}>
      <p className="text-muted">Уберите телефоны, пока все подключаются — ведущий всё настроит за минуту.</p>
      <PlayersStrip />
      {hostAway ? (
        <BigButton variant="secondary" onClick={() => act({ type: 'claim_host' })}>
          👑 Стать ведущим
        </BigButton>
      ) : null}
      <p className="text-xs text-faint">Ведущий: {nameOf(state, state.hostId)}</p>
    </Screen>
  );
}

type Step = 'company' | 'name' | 'code' | 'occasion' | 'hero' | 'length';

export function SetupWizard() {
  const { state, act, busy } = useGame();
  const [step, setStep] = useState<Step>('company');
  const [companyMode, setCompanyMode] = useState<'new' | 'continue'>('new');
  const [companyName, setCompanyName] = useState('');
  const [code, setCode] = useState('');
  const [occasion, setOccasion] = useState<Occasion>('meetup');
  const [heroId, setHeroId] = useState<string | null>(null);

  const start = (mode: EpisodeMode) =>
    act({ type: 'setup', companyMode, companyName: companyName.trim(), code: code.trim(), occasion, mode, heroId });

  const back = (to: Step) => (
    <button onClick={() => setStep(to)} className="self-start text-sm text-muted">
      ← {t.common.back}
    </button>
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      {step === 'company' ? (
        <Screen kicker={`${t.game.youAreHost} · шаг 1`} title="Кто сегодня за столом?">
          <PlayersStrip />
          <div className="grid gap-3">
            <BigButton
              onClick={() => {
                setCompanyMode('new');
                setStep('name');
              }}
            >
              ✨ {t.game.newCompany}
            </BigButton>
            <BigButton
              variant="secondary"
              onClick={() => {
                setCompanyMode('continue');
                setStep('code');
              }}
            >
              🔑 {t.game.continueSeason}
            </BigButton>
          </div>
        </Screen>
      ) : null}

      {step === 'name' ? (
        <Screen kicker="шаг 2" title={t.game.companyName}>
          {back('company')}
          <input
            autoFocus
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder={t.game.companyNamePh}
            maxLength={40}
            className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-xl"
          />
          <BigButton disabled={!companyName.trim()} onClick={() => setStep('occasion')}>
            {t.game.next}
          </BigButton>
        </Screen>
      ) : null}

      {step === 'code' ? (
        <Screen kicker="шаг 2" title={t.game.code}>
          {back('company')}
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder={t.game.codePh}
            autoCapitalize="characters"
            autoComplete="off"
            className="tabular w-full rounded-2xl border border-line bg-surface px-4 py-4 text-center font-mono text-4xl tracking-[0.4em] uppercase"
          />
          <BigButton disabled={code.trim().length !== 4} onClick={() => setStep('occasion')}>
            {t.game.next}
          </BigButton>
        </Screen>
      ) : null}

      {step === 'occasion' ? (
        <Screen kicker="шаг 3" title={t.game.occasion}>
          {back(companyMode === 'new' ? 'name' : 'code')}
          <div className="grid grid-cols-2 gap-3">
            {OCCASIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  setOccasion(o.id);
                  setStep(o.id === 'meetup' ? 'length' : 'hero');
                }}
                className="flex aspect-[1.1] flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3 text-center transition active:scale-95"
              >
                <span className="text-4xl" aria-hidden>
                  {o.icon}
                </span>
                <span className="font-semibold leading-tight">{t.game.occasions[o.id]}</span>
              </button>
            ))}
          </div>
        </Screen>
      ) : null}

      {step === 'hero' ? (
        <Screen kicker="шаг 4" title={t.game.hero}>
          {back('occasion')}
          <div className="grid grid-cols-2 gap-2">
            {state.players.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setHeroId(p.id);
                  setStep('length');
                }}
                className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-3 text-left active:scale-95"
              >
                <Avatar player={p} size={32} />
                <span className="truncate font-medium">{p.name}</span>
              </button>
            ))}
          </div>
          <BigButton
            variant="ghost"
            onClick={() => {
              setHeroId(null);
              setStep('length');
            }}
          >
            {t.game.heroSkip}
          </BigButton>
        </Screen>
      ) : null}

      {step === 'length' ? (
        <Screen kicker="последний шаг" title={t.game.length}>
          {back(occasion === 'meetup' ? 'occasion' : 'hero')}
          <div className="grid gap-3">
            <button
              disabled={busy}
              onClick={() => start('short')}
              className="rounded-2xl bg-accent px-5 py-5 text-left text-accent-ink transition active:scale-[0.98] disabled:opacity-60"
            >
              <span className="block text-xl font-bold">⚡ {t.game.short}</span>
              <span className="text-sm opacity-80">{t.game.shortHint}</span>
            </button>
            <button
              disabled={busy}
              onClick={() => start('full')}
              className="rounded-2xl border border-line bg-surface-2 px-5 py-5 text-left transition active:scale-[0.98] disabled:opacity-60"
            >
              <span className="block text-xl font-bold">🍽 {t.game.full}</span>
              <span className="text-sm text-muted">{t.game.fullHint}</span>
            </button>
          </div>
          {busy ? <p className="text-center text-muted">{t.game.preparing}</p> : null}
        </Screen>
      ) : null}
    </div>
  );
}

export function IntroScreen() {
  const { state, act, busy } = useGame();
  const c = state.company;
  if (!c) return null;
  return (
    <>
      <Screen kicker={`${t.game.season} «${c.season}» · ${fmt(t.game.episode, { n: state.episodeNo })}`} title={c.name}>
        <div className="rounded-3xl border border-accent/40 bg-accent-soft p-5 text-center">
          <p className="text-sm text-muted">{t.game.code}</p>
          <p className="tabular my-1 font-mono text-5xl font-black tracking-[0.3em] text-accent">{c.code}</p>
          <p className="text-sm text-muted">{t.game.rememberCode}</p>
        </div>
        {c.prevSummary ? (
          <div className="rounded-2xl bg-surface-2 p-4">
            <p className="text-xs uppercase tracking-widest text-faint">{t.game.previously}</p>
            <p className="mt-1 leading-snug">{c.prevSummary}</p>
          </div>
        ) : null}
        <ol className="space-y-2">
          {state.rounds.map((r, i) => (
            <li key={r} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-sm font-bold">{i + 1}</span>
              <span className="font-medium">{t.game.rounds[r]}</span>
              {r === 'final' ? <span className="ml-auto text-xs text-faint">{t.game.finalSub}</span> : null}
            </li>
          ))}
        </ol>
        {state.adapted === 'pending' ? <p className="animate-pulse text-sm text-muted">✨ {t.game.preparing}</p> : null}
      </Screen>
      <HostBar>
        <BigButton onClick={() => act({ type: 'start' })} disabled={busy}>
          {t.game.go} →
        </BigButton>
      </HostBar>
    </>
  );
}
