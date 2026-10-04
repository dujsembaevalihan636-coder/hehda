import { describe, expect, it } from 'vitest';

import { seedZones } from '../db/seed';
import type { Zone } from '../types';
import { CONTROL, decide, guestTooLoud, type ControlInput, type ControlReading } from './control';

const NOW = Date.parse('2026-10-09T21:15:00.000Z');
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function zoneA(patch: Partial<Zone> = {}): Zone {
  return { ...seedZones()[0], ...patch };
}

/** Показания одного датчика за последние 30 секунд (каждые 2 с). */
function readings(db: number, sensor = 's1', table_no: number | null = null, count = 15): ControlReading[] {
  return Array.from({ length: count }, (_, i) => ({ sensor_id: sensor, table_no, db, t: NOW - i * 2000 }));
}

function input(over: Partial<ControlInput> = {}): ControlInput {
  return {
    zone: zoneA(),
    now: NOW,
    readings: [],
    tooLoudPresses10m: 0,
    autoDowns10m: 0,
    lastAlertAt: {},
    lastForecastAt: null,
    upcomingGuests30m: 0,
    ...over,
  };
}

describe('decide()', () => {
  it('без данных ничего не меняет', () => {
    const out = decide(input());
    expect(out.patch).toEqual({});
    expect(out.events).toEqual([]);
    expect(out.estimate.median30).toBeNull();
  });

  it('громко (> target_max + 3) → громкость −10% и событие с уровнем', () => {
    const out = decide(input({ readings: readings(70) }));
    expect(out.patch.control_state).toBe('loud');
    expect(out.patch.music_volume).toBe(0.5);
    expect(out.events).toHaveLength(1);
    expect(out.events[0].type).toBe('auto_volume_down');
    expect(out.events[0].payload).toMatchObject({ reason: 'sensor', db: 70, from: 0.6, to: 0.5 });
  });

  it('в пределах +3 дБ над целью — не дёргает музыку (гистерезис входа)', () => {
    const out = decide(input({ readings: readings(67) }));
    expect(out.patch.music_volume).toBeUndefined();
    expect(out.patch.control_state).toBeUndefined();
    expect(out.patch.above_since).toBe(new Date(NOW).toISOString());
  });

  it('пауза 60 секунд между изменениями', () => {
    const z = zoneA({ control_state: 'loud', state_since: isoAgo(40_000), last_change_at: isoAgo(30_000) });
    const out = decide(input({ zone: z, readings: readings(72) }));
    expect(out.patch.music_volume).toBeUndefined();
    expect(out.events.filter((e) => e.type !== 'alert')).toHaveLength(0);
  });

  it('громко дольше 2 минут → ещё −10% и темп слабее в одном решении', () => {
    const z = zoneA({
      control_state: 'loud',
      state_since: isoAgo(130_000),
      last_change_at: isoAgo(65_000),
      music_volume: 0.5,
      tempo: 'mid',
    });
    const out = decide(input({ zone: z, readings: readings(71), autoDowns10m: 1 }));
    expect(out.patch.music_volume).toBe(0.4);
    expect(out.patch.tempo).toBe('slow');
    expect(out.events[0]).toMatchObject({ type: 'auto_volume_down', payload: { tempo_from: 'mid', tempo_to: 'slow' } });
  });

  it('гистерезис выхода: «громко» держится до target_max + 1', () => {
    const z = zoneA({ control_state: 'loud', state_since: isoAgo(50_000), last_change_at: isoAgo(10_000) });
    expect(decide(input({ zone: z, readings: readings(66.5) })).patch.control_state).toBeUndefined();
    expect(decide(input({ zone: z, readings: readings(65.5) })).patch.control_state).toBe('ok');
  });

  it('слишком тихо → громкость +5%', () => {
    const out = decide(input({ readings: readings(55) }));
    expect(out.patch.control_state).toBe('quiet');
    expect(out.patch.music_volume).toBe(0.65);
    expect(out.events[0]).toMatchObject({ type: 'auto_volume_up', payload: { reason: 'too_quiet' } });
  });

  it('громкость не опускается ниже 0.15', () => {
    const z = zoneA({ music_volume: 0.2, music_ref_db: 40 });
    const out = decide(input({ zone: z, readings: readings(70) }));
    expect(out.patch.music_volume).toBe(CONTROL.MIN_VOLUME);
  });

  it('шумит компания, а музыка уже на минимуме → алерт «пересадка» вместо снижения', () => {
    const z = zoneA({ control_state: 'loud', state_since: isoAgo(200_000), music_volume: 0.15 });
    const out = decide(
      input({ zone: z, readings: readings(74), suspect: { table_no: 7, party_size: 8 } }),
    );
    expect(out.patch.music_volume).toBeUndefined();
    const relocate = out.alerts.find((a) => a.kind === 'relocate');
    expect(relocate?.data).toMatchObject({ table_no: 7, party_size: 8 });
    expect(out.events.some((e) => e.type === 'alert' && e.payload.kind === 'relocate')).toBe(true);
  });

  it('после 3 снижений за 10 минут без эффекта — пересадка, а не бесконечное снижение', () => {
    const z = zoneA({ control_state: 'loud', state_since: isoAgo(200_000), last_change_at: isoAgo(70_000), music_volume: 0.3 });
    const out = decide(input({ zone: z, readings: readings(73), autoDowns10m: 3 }));
    expect(out.patch.music_volume).toBeUndefined();
    expect(out.alerts.map((a) => a.kind)).toContain('relocate');
  });

  it('один датчик громче остальных на 6+ дБ → «горячий стол»', () => {
    const r = [...readings(76, 'hot', 5), ...readings(62, 'calm1', 2), ...readings(63, 'calm2', 10)];
    const z = zoneA({ control_state: 'loud', state_since: isoAgo(40_000), music_volume: 0.4 });
    const out = decide(input({ zone: z, readings: r }));
    expect(out.estimate.hotSensor?.sensor_id).toBe('hot');
    expect(out.alerts.find((a) => a.kind === 'relocate')?.data.table_no).toBe(5);
  });

  it('выше цели больше 5 минут → алерт, повтор не чаще раза в 10 минут', () => {
    const z = zoneA({ above_since: isoAgo(6 * 60_000), control_state: 'ok' });
    const first = decide(input({ zone: z, readings: readings(66) }));
    expect(first.alerts.map((a) => a.kind)).toContain('above_5min');
    expect(first.events.some((e) => e.type === 'alert')).toBe(true);
    const again = decide(input({ zone: z, readings: readings(66), lastAlertAt: { above_5min: NOW - 120_000 } }));
    expect(again.alerts.map((a) => a.kind)).toContain('above_5min');
    expect(again.events.some((e) => e.type === 'alert')).toBe(false);
  });

  it('3+ нажатия «Громко?» за 10 минут → алерт', () => {
    const out = decide(input({ readings: readings(63), tooLoudPresses10m: 3 }));
    expect(out.alerts.map((a) => a.kind)).toEqual(['guest_presses']);
  });

  it('прогноз: через 30 минут придут 20 гостей → заранее −10%', () => {
    const out = decide(input({ readings: readings(62), upcomingGuests30m: 20 }));
    expect(out.patch.music_volume).toBe(0.5);
    expect(out.events[0]).toMatchObject({ type: 'auto_volume_down', payload: { reason: 'forecast', guests: 20 } });
    const repeat = decide(input({ readings: readings(62), upcomingGuests30m: 20, lastForecastAt: NOW - 10 * 60_000 }));
    expect(repeat.patch.music_volume).toBeUndefined();
  });

  it('ручной режим: алгоритм не трогает музыку, но алерты работают', () => {
    const z = zoneA({ auto_mode: false, above_since: isoAgo(6 * 60_000) });
    const out = decide(input({ zone: z, readings: readings(75) }));
    expect(out.patch.music_volume).toBeUndefined();
    expect(out.alerts.map((a) => a.kind)).toContain('above_5min');
  });

  it('оценка «шума гостей» вычитает вклад музыки', () => {
    // музыка: 60 дБ при 0.6; измерено 63 дБ → гости ≈ 60 дБ
    const out = decide(input({ readings: readings(63) }));
    expect(out.estimate.musicDb).toBe(60);
    expect(out.estimate.guestDb).toBeCloseTo(60, 0);
  });
});

describe('guestTooLoud()', () => {
  it('−5% мгновенно, но не ниже минимума', () => {
    expect(guestTooLoud(zoneA(), NOW, 5).patch.music_volume).toBe(0.55);
    expect(guestTooLoud(zoneA({ music_volume: 0.15 }), NOW, 5).patch).toEqual({});
  });
});
