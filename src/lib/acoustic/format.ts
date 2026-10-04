import type { HallEvent, Tempo } from '../types';
import { TEMPO_LABEL } from '../zones';

// Человекочитаемая лента событий: «21:15 · Зона A 74 дБ → музыка −10%, темп медленный».

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const timeHM = (iso: string | number) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const signedPct = (from: number, to: number) => {
  const d = Math.round((to - from) * 100);
  return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}%`;
};

export type EventTone = 'down' | 'up' | 'tempo' | 'alert' | 'manual' | 'info';

export interface FormattedEvent {
  time: string;
  zone: string | null;
  text: string;
  tone: EventTone;
}

export function formatEvent(e: Pick<HallEvent, 'type' | 'zone_id' | 'payload' | 'created_at'>): FormattedEvent {
  const p = e.payload as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null);
  const zone = e.zone_id ? `Зона ${e.zone_id}` : null;
  const time = timeHM(e.created_at);
  const db = num('db');
  const from = num('from');
  const to = num('to');
  const tempoTo = p.tempo_to as Tempo | undefined;
  const tempoFrom = p.tempo_from as Tempo | undefined;
  const tempoPart = tempoTo && tempoFrom && tempoTo !== tempoFrom ? `, темп ${TEMPO_LABEL[tempoTo]}` : '';
  const vol = from !== null && to !== null ? signedPct(from, to) : '';

  switch (e.type) {
    case 'auto_volume_down': {
      if (p.reason === 'guest') {
        const table = num('table_no');
        const src = table ? `«Громко?» со стола ${table}` : '«Громко?»';
        return {
          time,
          zone,
          tone: 'down',
          text: from !== null && to !== null && to < from ? `${src} → музыка ${vol}` : `${src} — музыка уже на минимуме`,
        };
      }
      if (p.reason === 'forecast') {
        const g = num('guests') ?? 0;
        return { time, zone, tone: 'down', text: `через 30 мин придут ${g} ${plural(g, ['гость', 'гостя', 'гостей'])} → музыка ${vol} заранее` };
      }
      return { time, zone, tone: 'down', text: `${db ?? '—'} дБ → музыка ${vol}${tempoPart}` };
    }
    case 'auto_volume_up':
      return { time, zone, tone: 'up', text: `${db ?? '—'} дБ — тихо, слышны соседи → музыка ${vol}${tempoPart}` };
    case 'tempo_change': {
      const mins = Math.max(1, Math.round((num('loud_for_s') ?? 120) / 60));
      const why = p.reason === 'too_quiet' ? 'слишком тихо' : `громко ${mins} ${plural(mins, ['минуту', 'минуты', 'минут'])}`;
      return {
        time,
        zone,
        tone: 'tempo',
        text: `${why} → темп ${tempoFrom ? TEMPO_LABEL[tempoFrom] : ''} → ${tempoTo ? TEMPO_LABEL[tempoTo] : ''}`,
      };
    }
    case 'alert': {
      if (p.kind === 'above_5min') {
        const m = num('minutes') ?? 5;
        return { time, zone, tone: 'alert', text: `выше цели уже ${m} ${plural(m, ['минуту', 'минуты', 'минут'])}${db ? ` (${db} дБ)` : ''}` };
      }
      if (p.kind === 'guest_presses') {
        const c = num('count') ?? 3;
        return { time, zone, tone: 'alert', text: `${c} ${plural(c, ['нажатие', 'нажатия', 'нажатий'])} «Громко?» за 10 минут` };
      }
      if (p.kind === 'relocate') {
        const table = num('table_no');
        const party = num('party_size');
        const who = table ? ` (стол ${table}${party ? `, ${party} чел.` : ''})` : '';
        return { time, zone, tone: 'alert', text: `шумит в основном одна компания${who} — предложите пересадку` };
      }
      return { time, zone, tone: 'alert', text: 'внимание' };
    }
    case 'manual': {
      if (p.calibrated) {
        const v = num('volume');
        return { time, zone, tone: 'manual', text: `калибровка «пустой зал»: музыка ${num('music_ref_db')} дБ при ${v !== null ? Math.round(v * 100) : '—'}%` };
      }
      const toObj = (p.to ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof toObj.music_volume === 'number') parts.push(`громкость ${Math.round(toObj.music_volume * 100)}%`);
      if (typeof toObj.tempo === 'string') parts.push(`темп ${TEMPO_LABEL[toObj.tempo as Tempo]}`);
      if (typeof toObj.auto_mode === 'boolean') parts.push(toObj.auto_mode ? 'авторежим включён' : 'авторежим выключен');
      if (Array.isArray(toObj.target)) parts.push(`цель ${toObj.target[0]}–${toObj.target[1]} дБ`);
      return { time, zone, tone: 'manual', text: `менеджер: ${parts.join(', ') || 'изменения'}` };
    }
    default:
      return { time, zone, tone: 'info', text: e.type };
  }
}
