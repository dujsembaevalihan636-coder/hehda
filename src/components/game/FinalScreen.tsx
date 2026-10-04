'use client';

import { useState } from 'react';

import { ACTIVE_MS } from '@/lib/game/types';
import { fmt, t } from '@/lib/i18n';

import { nameOf, useGame } from './context';
import { useMyMission } from './MissionScreens';
import { Avatar, BigButton, HostBar, Screen } from './ui';

const LETTERS = ['А', 'Б', 'В', 'Г'];

export function FinalScreen() {
  const { state } = useGame();
  const f = state.final;
  if (!f) return null;
  if (f.stage === 'guess' || f.stage === 'reveal') return <GuessStage />;
  if (f.stage === 'quotes') return <QuotesStage />;
  return <QuoteVoteStage />;
}

function Scoreboard() {
  const { state } = useGame();
  const rows = [...state.players].sort((a, b) => (state.points[b.id] ?? 0) - (state.points[a.id] ?? 0));
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((p) => (
        <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-sm">
          <Avatar player={p} size={24} />
          <span className="tabular font-semibold">{state.points[p.id] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

function GuessStage() {
  const { state, me, act, busy, now } = useGame();
  const { mission } = useMyMission();
  const f = state.final!;
  const owner = f.order[f.idx];
  const ownerRef = state.missions.find((m) => m.playerId === owner);
  const isOwner = owner === me.id;
  const myGuess = f.guesses[me.id];
  const guessers = state.players.filter((p) => p.id !== owner && now - p.lastSeen <= ACTIVE_MS);
  const guessed = Object.keys(f.guesses).length;
  const reveal = f.stage === 'reveal';
  const result = reveal ? f.results[f.results.length - 1] : null;
  const isLast = f.idx + 1 >= f.order.length;

  return (
    <>
      <Screen
        kicker={`${t.game.rounds.final} · ${t.game.finalSub} · ${f.idx + 1}/${f.order.length}`}
        title={fmt(t.game.whoseMission, { name: nameOf(state, owner) })}
      >
        <Scoreboard />
        {!reveal && isOwner ? (
          <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 text-center">
            <p className="text-xl font-semibold">🤫 {t.game.yourMissionGuessed}</p>
            {mission ? <p className="text-muted">«{mission.text}»</p> : null}
            {!ownerRef?.done ? (
              <>
                <p className="font-medium">{t.game.didYouDoIt}</p>
                <div className="grid grid-cols-2 gap-2">
                  <BigButton onClick={() => act({ type: 'mission_done', done: true })} disabled={busy}>
                    {t.game.iDidIt}
                  </BigButton>
                  <BigButton variant="secondary" onClick={() => act({ type: 'mission_done', done: false })} disabled={busy}>
                    {t.game.notYet}
                  </BigButton>
                </div>
              </>
            ) : (
              <p className="text-ok">✓ {t.game.missionDoneShort}</p>
            )}
            <p className="text-sm text-faint">
              {guessed} / {guessers.length}
            </p>
          </div>
        ) : null}

        {!reveal && !isOwner ? (
          <>
            <p className="text-muted">{t.game.guessWhat}</p>
            <div className="grid gap-2.5">
              {f.options.map((o, i) => (
                <button
                  key={i}
                  data-testid="guess-option"
                  disabled={busy}
                  onClick={() => act({ type: 'guess', option: i })}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98] ${
                    myGuess === i ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-bold">{LETTERS[i]}</span>
                  <span className="leading-snug">{o}</span>
                </button>
              ))}
            </div>
            {myGuess !== undefined ? (
              <p className="text-center text-sm text-muted">
                ✓ {t.game.guessAccepted} · {guessed} / {guessers.length}
              </p>
            ) : null}
          </>
        ) : null}

        {reveal && result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t.game.revealTitle}</p>
            <div className="grid gap-2">
              {f.options.map((o, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                    i === f.correct ? 'animate-pop border-ok bg-ok/15' : 'border-line bg-surface opacity-45'
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-bold">
                    {i === f.correct ? '✓' : LETTERS[i]}
                  </span>
                  <span className="leading-snug">{o}</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-surface-2 p-4 text-center">
              {result.guessedBy.length ? (
                <p className="font-semibold">🎯 {fmt(t.game.guessedBy, { names: result.guessedBy.map((id) => nameOf(state, id)).join(', ') })} · +1</p>
              ) : (
                <p className="font-semibold">🙈 {t.game.nobodyGuessed}</p>
              )}
              {result.done && !result.guessedBy.length ? <p className="mt-1 text-ok">{t.game.unnoticed}</p> : null}
              {!result.done ? <p className="mt-1 text-faint">{t.game.notDone}</p> : null}
            </div>
          </div>
        ) : null}
      </Screen>
      <HostBar>
        {reveal ? (
          <BigButton onClick={() => act({ type: 'next' })} disabled={busy}>
            {isLast ? `${t.game.quoteTitle} →` : `${t.game.nextMission} →`}
          </BigButton>
        ) : (
          <BigButton onClick={() => act({ type: 'reveal' })} disabled={busy}>
            {t.game.reveal}
          </BigButton>
        )}
      </HostBar>
    </>
  );
}

function QuotesStage() {
  const { state, me, act, busy } = useGame();
  const f = state.final!;
  const mine = f.quotes.find((q) => q.playerId === me.id);
  const [text, setText] = useState('');

  return (
    <>
      <Screen kicker={`${t.game.rounds.final} · ${t.game.finalSub}`} title={t.game.quoteTitle}>
        {mine ? (
          <div className="rounded-3xl border border-line bg-surface p-6 text-center">
            <p className="text-xl font-semibold">✓ {t.game.quoteSent}</p>
            <p className="mt-2 text-muted">«{mine.text}»</p>
            <p className="mt-3 text-sm text-faint">
              {f.quotes.length} / {state.players.length}
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted">{t.game.quotePrompt}</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.replace(/\n/g, ' ').slice(0, 120))}
              placeholder={t.game.quotePh}
              rows={3}
              className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-lg"
            />
            <BigButton onClick={() => act({ type: 'quote', text })} disabled={busy || !text.trim()}>
              {t.game.send}
            </BigButton>
          </>
        )}
      </Screen>
      <HostBar>
        <BigButton onClick={() => act({ type: 'next' })} disabled={busy}>
          {t.game.next} →
        </BigButton>
      </HostBar>
    </>
  );
}

function QuoteVoteStage() {
  const { state, me, act, busy } = useGame();
  const f = state.final!;
  const myVote = f.quoteVotes[me.id];
  return (
    <>
      <Screen kicker={`${t.game.rounds.final} · ${t.game.quoteTitle}`} title={t.game.quoteVote}>
        <div className="grid gap-2.5">
          {f.quotes.map((q) => {
            const own = q.playerId === me.id;
            return (
              <button
                key={q.id}
                data-testid="quote-option"
                disabled={busy || own}
                onClick={() => act({ type: 'quote_vote', quoteId: q.id })}
                className={`rounded-2xl border px-4 py-4 text-left text-lg leading-snug transition active:scale-[0.98] ${
                  myVote === q.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                } ${own ? 'opacity-50' : ''}`}
              >
                «{q.text}»{own ? <span className="ml-2 text-xs text-faint">твоя</span> : null}
              </button>
            );
          })}
        </div>
        {myVote ? <p className="text-center text-sm text-muted">✓ {t.game.guessAccepted}</p> : null}
      </Screen>
      <HostBar>
        <BigButton onClick={() => act({ type: 'next' })} disabled={busy}>
          {t.game.toSummary} →
        </BigButton>
      </HostBar>
    </>
  );
}
