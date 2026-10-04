'use client';

import { ACTIVE_MS, QUESTIONS_PER_ROUND, type VoteRound } from '@/lib/game/types';
import { fmt, t } from '@/lib/i18n';

import { useGame } from './context';
import { MissionPeek } from './MissionScreens';
import { Avatar, BigButton, HostBar, PhonesDown, Screen } from './ui';

export function VoteScreen({ round }: { round: VoteRound }) {
  const { state, me, act, busy, now } = useGame();
  const vote = state.vote;
  if (!vote) return null;
  const q = state.questions[round][vote.idx];
  const myVote = vote.votes[me.id];
  const active = state.players.filter((p) => now - p.lastSeen <= ACTIVE_MS);
  const votedCount = Object.keys(vote.votes).length;
  const total = Math.min(QUESTIONS_PER_ROUND, state.questions[round].length);
  const roundNo = state.roundIdx + 1;
  const isLast = vote.idx + 1 >= total;

  const tally = state.players
    .map((p) => ({ p, n: Object.values(vote.votes).filter((x) => x === p.id).length }))
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...tally.map((x) => x.n));

  return (
    <>
      <Screen
        kicker={`${fmt(t.game.roundOf, { i: roundNo, n: state.rounds.length })} · ${t.game.rounds[round]} · ${fmt(t.game.questionOf, { i: vote.idx + 1, n: total })}`}
        title={q?.text ?? '…'}
      >
        {state.missions.length ? <MissionPeek /> : null}
        {vote.stage === 'vote' ? (
          myVote ? (
            <div className="rounded-3xl border border-line bg-surface p-6 text-center">
              <p className="text-2xl font-bold">✓ {t.game.voted}</p>
              <p className="mt-2 text-muted">{fmt(t.game.votes, { n: votedCount, m: Math.max(active.length, votedCount) })}</p>
              <p className="mt-4 text-sm text-faint">{t.game.waitingOthers}</p>
            </div>
          ) : (
            <>
              <p className="text-muted">{t.game.vote}</p>
              <div className="grid grid-cols-2 gap-3">
                {state.players.map((p) => (
                  <button
                    key={p.id}
                    data-testid="vote-option"
                    disabled={busy}
                    onClick={() => act({ type: 'vote', target: p.id })}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-4 text-left transition active:scale-95 disabled:opacity-60"
                  >
                    <Avatar player={p} size={38} />
                    <span className="min-w-0 truncate text-lg font-semibold">{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <ul className="space-y-2">
              {tally.map(({ p, n }, i) => (
                <li key={p.id} className="flex animate-rise items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
                  <Avatar player={p} size={34} ring={i === 0 && n > 0} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm">
                      <span className={i === 0 && n > 0 ? 'font-bold' : ''}>{p.name}</span>
                      <span className="tabular text-muted">{n}</span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-center text-lg font-semibold">
              🗣 {t.game.discuss}
            </div>
            <PhonesDown title={t.game.phonesDown} />
          </>
        )}
      </Screen>
      <HostBar>
        {vote.stage === 'vote' ? (
          <>
            <BigButton variant="secondary" onClick={() => act({ type: 'skip' })} disabled={busy} className="!w-auto shrink-0 px-4">
              {t.game.skip}
            </BigButton>
            <BigButton onClick={() => act({ type: 'reveal' })} disabled={busy || votedCount === 0}>
              {t.game.showResults}
            </BigButton>
          </>
        ) : (
          <BigButton onClick={() => act({ type: 'next' })} disabled={busy}>
            {isLast ? `${t.game.toNextRound} →` : `${t.game.nextQuestion} →`}
          </BigButton>
        )}
      </HostBar>
    </>
  );
}
