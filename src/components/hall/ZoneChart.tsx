'use client';

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { timeHM } from '@/lib/acoustic/format';
import { levelStatus, STATUS_COLOR, STATUS_LABEL } from '@/lib/zones';

// Уровень шума зоны за 15 минут: одна серия (название — в заголовке карточки),
// полоса целевого диапазона и пунктир порога «громко» (цель + 3 дБ).

interface Props {
  series: { t: number; db: number | null }[];
  min: number;
  max: number;
  height?: number;
}

export function ZoneChart({ series, min, max, height = 150 }: Props) {
  const values = series.map((p) => p.db).filter((v): v is number => v !== null);
  const lo = Math.floor(Math.min(min - 8, ...values) / 5) * 5;
  const hi = Math.ceil(Math.max(max + 8, ...values) / 5) * 5;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="#2c2520" vertical={false} />
          <ReferenceArea y1={min} y2={max} fill="#0ca30c" fillOpacity={0.13} stroke="none" ifOverflow="extendDomain" />
          <ReferenceLine y={max + 3} stroke="#d03b3b" strokeOpacity={0.55} strokeDasharray="4 4" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => timeHM(v)}
            stroke="#7d6d61"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#3a2d25' }}
            minTickGap={48}
          />
          <YAxis domain={[lo, hi]} stroke="#7d6d61" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: '#b9a797', strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { t: number; db: number | null } | undefined;
              if (!active || !p) return null;
              const st = levelStatus(p.db, min, max);
              return (
                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-xl">
                  <div className="text-muted">{timeHM(p.t)}</div>
                  <div className="tabular text-base font-semibold text-ink">{p.db === null ? 'нет данных' : `${p.db.toFixed(1)} дБ`}</div>
                  {p.db !== null ? (
                    <div className="flex items-center gap-1.5 text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                      {STATUS_LABEL[st]} · цель {min}–{max}
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="db"
            stroke="#f6ece2"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: '#f6ece2', stroke: '#1b1512', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
