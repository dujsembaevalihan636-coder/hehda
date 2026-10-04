'use client';

import { HALL_TABLES, HALL_VIEWBOX, ZONE_RECTS } from '@/lib/hall-layout';
import type { ZoneId } from '@/lib/types';
import { levelStatus, STATUS_COLOR, STATUS_LABEL, trafficLabel, ZONE_IDS, ZONES } from '@/lib/zones';

export interface HallMapZone {
  id: ZoneId;
  level: number | null;
  min: number;
  max: number;
}

interface Props {
  zones: HallMapZone[];
  busyTables?: number[];
  pressedTables?: number[];
  hotTables?: number[];
  highlightTable?: number | null;
  /** traffic — «пробки» для гостей (тихо/умеренно/шумно), status — относительно цели зоны */
  mode?: 'status' | 'traffic';
  focusZone?: ZoneId | null;
  className?: string;
}

export function HallMap({
  zones,
  busyTables = [],
  pressedTables = [],
  hotTables = [],
  highlightTable = null,
  mode = 'status',
  focusZone = null,
  className = '',
}: Props) {
  const byId = Object.fromEntries(zones.map((z) => [z.id, z])) as Record<ZoneId, HallMapZone | undefined>;
  const busy = new Set(busyTables);
  const pressed = new Set(pressedTables);
  const hot = new Set(hotTables);

  return (
    <svg
      viewBox={`0 0 ${HALL_VIEWBOX.w} ${HALL_VIEWBOX.h}`}
      className={`h-auto w-full ${className}`}
      role="img"
      aria-label="Схема зала: три зоны, цвет — уровень шума"
    >
      <defs>
        <pattern id="window" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#1b1512" />
          <line x1="0" y1="7" x2="14" y2="7" stroke="#3a2d25" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={HALL_VIEWBOX.w} height={HALL_VIEWBOX.h} rx="22" fill="#15100d" />
      {/* окна вдоль левой стены */}
      <rect x="2" y="90" width="6" height="520" fill="url(#window)" opacity="0.9" />

      {ZONE_IDS.map((id) => {
        const r = ZONE_RECTS[id];
        const z = byId[id];
        const level = z?.level ?? null;
        const status = mode === 'traffic' ? null : levelStatus(level, z?.min ?? ZONES[id].targetMin, z?.max ?? ZONES[id].targetMax);
        const traffic = trafficLabel(level);
        const color = mode === 'traffic' ? traffic.color : STATUS_COLOR[status ?? 'none'];
        const label = mode === 'traffic' ? traffic.label : STATUS_LABEL[status ?? 'none'];
        const dim = focusZone && focusZone !== id;
        return (
          <g key={id} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 300ms' }}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx="16"
              fill={color}
              fillOpacity={level === null ? 0.06 : 0.16}
              stroke={color}
              strokeOpacity={0.7}
              strokeWidth={2}
              style={{ transition: 'fill 600ms, stroke 600ms' }}
            />
            <text x={r.x + 16} y={r.y + 30} fill="#f6ece2" fontSize="20" fontWeight="700">
              {id} · {ZONES[id].name}
            </text>
            <text x={r.x + 16} y={r.y + 50} fill="#b9a797" fontSize="13">
              {mode === 'traffic' ? label : `цель ${z?.min ?? ZONES[id].targetMin}–${z?.max ?? ZONES[id].targetMax} дБ · ${label}`}
            </text>
            <text
              x={r.x + r.w - 16}
              y={r.y + 42}
              textAnchor="end"
              fill={level === null ? '#7d6d61' : '#f6ece2'}
              fontSize="34"
              fontWeight="800"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {level === null ? '—' : Math.round(level)}
              <tspan fontSize="15" fontWeight="600" fill="#b9a797">
                {' '}
                дБ
              </tspan>
            </text>
          </g>
        );
      })}

      {HALL_TABLES.map((tb) => {
        const isBusy = busy.has(tb.table_no);
        const isPressed = pressed.has(tb.table_no);
        const isHot = hot.has(tb.table_no);
        const isHi = highlightTable === tb.table_no;
        const dim = focusZone && focusZone !== tb.zone_id;
        const fill = isHi ? '#f59e4c' : isBusy ? '#4a3a2e' : '#2a211b';
        const stroke = isPressed || isHot ? STATUS_COLOR.bad : isHi ? '#f59e4c' : '#5a4738';
        const common = {
          fill,
          stroke,
          strokeWidth: isPressed || isHot ? 3 : 1.5,
          style: { transition: 'fill 300ms' } as React.CSSProperties,
        };
        return (
          <g key={tb.table_no} opacity={dim ? 0.35 : 1}>
            {tb.shape === 'round' ? (
              <circle cx={tb.x} cy={tb.y} r={tb.w / 2} {...common} />
            ) : (
              <rect x={tb.x - tb.w / 2} y={tb.y - tb.h / 2} width={tb.w} height={tb.h} rx={tb.shape === 'bar' ? 10 : 7} {...common} />
            )}
            {isPressed || isHot ? (
              <circle cx={tb.x} cy={tb.y} r={Math.max(tb.w, tb.h > 100 ? 30 : tb.h) / 2 + 8} fill="none" stroke={STATUS_COLOR.bad} strokeWidth={2}>
                <animate attributeName="opacity" values="0.9;0.1;0.9" dur="1.6s" repeatCount="indefinite" />
              </circle>
            ) : null}
            <text
              x={tb.x}
              y={tb.y + 4}
              textAnchor="middle"
              fontSize={tb.shape === 'bar' ? 14 : 12}
              fontWeight="700"
              fill={isHi ? '#1f1206' : '#d9c9ba'}
              transform={tb.shape === 'bar' ? `rotate(-90 ${tb.x} ${tb.y})` : undefined}
            >
              {tb.shape === 'bar' ? `БАР · ${tb.seats} мест` : tb.table_no}
            </text>
          </g>
        );
      })}

      <text x={HALL_VIEWBOX.w / 2} y={HALL_VIEWBOX.h - 6} textAnchor="middle" fill="#7d6d61" fontSize="12">
        ▲ вход
      </text>
    </svg>
  );
}
