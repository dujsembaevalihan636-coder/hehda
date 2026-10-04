'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatEvent } from '@/lib/acoustic/format';
import { SIM_MINUTES, simLabel, simulateFriday, type SimPoint, type SimResult } from '@/lib/acoustic/sim';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';
import { pct, ZONE_IDS, ZONES } from '@/lib/zones';

// «Симуляция пятницы 20:00–23:00»: 3 часа за 60 секунд, два графика рядом.
// Работает целиком в браузере — запасной план, если в зале нет сети.

const DURATION_MS = 60_000;

export function FridaySimulation({ autoStart = false }: { autoStart?: boolean }) {
  const without = useMemo(() => simulateFriday(false), []);
  const withSys = useMemo(() => simulateFriday(true), []);
  const [m, setM] = useState(autoStart ? 0 : -1); // −1 — ещё не запускали
  const raf = useRef(0);

  const start = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS);
      const next = Math.floor(p * SIM_MINUTES);
      setM((prev) => (prev === next ? prev : next));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    setM(0);
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (autoStart) start();
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cursor = Math.max(0, m);
  const running = m >= 0 && m < SIM_MINUTES;

  return (
    <section className="rounded-3xl border border-line bg-surface p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t.demo.friday}</h2>
          <p className="text-sm text-muted">
            {t.demo.fridayHint}. Без системы музыку прибавляют «на глаз», с системой — работает тот же алгоритм, что в /api/control.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {m >= 0 ? (
            <div className="text-right">
              <div className="tabular text-4xl font-bold">{simLabel(cursor)}</div>
              <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-accent" style={{ width: `${(cursor / SIM_MINUTES) * 100}%` }} />
              </div>
            </div>
          ) : null}
          <button onClick={start} className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            {m < 0 ? `▶︎ ${t.demo.friday}` : running ? '↺ Заново' : '↺ Повторить'}
          </button>
        </div>
      </header>

      {m < 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-6 text-center text-muted">
          Нажмите кнопку — за минуту проиграем вечер пятницы: 200 гостей, день рождения в зоне B, шумная компания в зоне A, гол на экране у бара.
        </p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <SimPanel title={t.demo.without} tone="bad" result={without} cursor={cursor} />
          <SimPanel title={t.demo.with} tone="ok" result={withSys} cursor={cursor} />
        </div>
      )}
    </section>
  );
}

function SimPanel({ title, tone, result, cursor }: { title: string; tone: 'ok' | 'bad'; result: SimResult; cursor: number }) {
  const data = result.points.slice(0, cursor + 1);
  const live = liveStats(data);
  const events = result.events.filter((e) => e.m <= cursor).slice(-4).reverse();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className={`text-lg font-semibold ${tone === 'bad' ? 'text-bad' : 'text-ok'}`}>{title}</h3>
        <span className="text-xs text-faint">полосы — целевые диапазоны зон</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 34, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="#2c2520" vertical={false} />
            {ZONE_IDS.map((id) => (
              <ReferenceArea key={id} y1={ZONES[id].targetMin} y2={ZONES[id].targetMax} fill={ZONES[id].hue} fillOpacity={0.09} stroke="none" />
            ))}
            <ReferenceLine x={cursor} stroke="#b9a797" strokeOpacity={0.4} />
            <XAxis
              dataKey="m"
              type="number"
              domain={[0, SIM_MINUTES]}
              ticks={[0, 30, 60, 90, 120, 150, 180]}
              tickFormatter={(v: number) => simLabel(v)}
              stroke="#7d6d61"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#3a2d25' }}
            />
            <YAxis domain={[55, 85]} ticks={[55, 60, 65, 70, 75, 80, 85]} stroke="#7d6d61" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: '#b9a797', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as SimPoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 text-muted">{simLabel(p.m)}</div>
                    {ZONE_IDS.map((id) => (
                      <div key={id} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: ZONES[id].hue }} />
                        <span className="w-24 text-muted">{ZONES[id].name}</span>
                        <span className="tabular font-semibold text-ink">{p[id].toFixed(1)} дБ</span>
                        <span className="tabular text-faint">муз. {Math.round(p[`vol${id}` as 'volA'] * 100)}%</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              height={24}
              iconType="plainline"
              formatter={(v: string) => <span className="text-xs text-muted">{ZONES[v as ZoneId]?.name ?? v}</span>}
            />
            {ZONE_IDS.map((id) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                name={id}
                stroke={ZONES[id].hue}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                label={(props: { x?: number | string; y?: number | string; index?: number }) =>
                  props.index === data.length - 1 && props.x !== undefined && props.y !== undefined ? (
                    <text key={`l-${id}`} x={Number(props.x) + 6} y={Number(props.y) + 4} fontSize={12} fontWeight={700} fill="#f6ece2">
                      {id}
                    </text>
                  ) : (
                    <g key={`l-${id}-${props.index}`} />
                  )
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ZONE_IDS.map((id) => {
          const s = live[id];
          return (
            <div key={id} className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: ZONES[id].hue }} />
                {ZONES[id].name}
              </div>
              <div className="tabular text-xl font-bold">{pct(s.inTarget)}</div>
              <div className="text-[11px] text-faint">
                {t.demo.inTarget} · <span className={s.red ? 'text-bad' : ''}>{s.red} мин красного</span>
              </div>
            </div>
          );
        })}
      </div>
      <ul className="min-h-[5.5rem] space-y-1 text-xs">
        {events.map((e, i) => {
          const f = formatEvent(e);
          return (
            <li key={`${e.m}-${e.zone_id}-${i}`} className="animate-fade-in truncate">
              <span className="tabular text-faint">{simLabel(e.m)}</span> <span className="font-semibold">Зона {e.zone_id}</span>{' '}
              <span className={f.tone === 'alert' ? 'text-bad' : 'text-ink/85'}>{f.text}</span>
            </li>
          );
        })}
        {!events.length ? <li className="text-faint">{tone === 'bad' ? 'музыка стоит как есть…' : 'алгоритм наблюдает…'}</li> : null}
      </ul>
    </div>
  );
}

function liveStats(points: SimPoint[]) {
  return Object.fromEntries(
    ZONE_IDS.map((id) => {
      const z = ZONES[id];
      const ls = points.map((p) => p[id]);
      const inTarget = ls.length ? ls.filter((l) => l >= z.targetMin && l <= z.targetMax).length / ls.length : 0;
      return [id, { inTarget, red: ls.filter((l) => l > z.targetMax + 3).length }];
    }),
  ) as Record<ZoneId, { inTarget: number; red: number }>;
}
