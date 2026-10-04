import 'server-only';

import { getDb } from '../db';
import { aiEnabled } from '../server/env';
import type { ContentItem } from '../types';
import { generateLibraryItems } from './ai';
import { RESERVE_CONTENT } from './content-seed';
import { parseRoomState } from './types';

// Данные админки Table Mode: активные столы, библиотека контента, аналитика возврата.

export async function activeRooms() {
  const rooms = await getDb().select('rooms', { order: [{ col: 'table_no' }] });
  const now = Date.now();
  return rooms
    .map((r) => ({ row: r, state: parseRoomState(r.state, now) }))
    .filter(({ state }) => state.phase !== 'idle')
    .map(({ row, state }) => ({
      table_no: row.table_no,
      phase: state.phase,
      players: state.players.map((p) => p.name),
      host: state.players.find((p) => p.id === state.hostId)?.name ?? null,
      company: state.company ? { name: state.company.name, code: state.company.code } : null,
      episodeNo: state.episodeNo,
      mode: state.mode,
      updated_at: row.updated_at,
      lastActivity: state.lastActivity,
    }));
}

export async function listContent(): Promise<ContentItem[]> {
  return getDb().select('content_library', { order: [{ col: 'created_at', asc: false }] });
}

export async function setApproved(id: string, approved: boolean) {
  const rows = await getDb().update('content_library', { approved }, [['id', 'eq', id]]);
  return rows[0] ?? null;
}

export async function deleteContent(id: string) {
  await getDb().remove('content_library', [['id', 'eq', id]]);
}

/** «Сгенерировать 20 новых»: AI → на модерацию (approved=false). Без AI — резервный набор. */
export async function generateNewContent(): Promise<{ added: number; source: 'ai' | 'reserve'; message: string }> {
  const db = getDb();
  const existing = await listContent();
  const texts = existing.map((c) => c.text);
  const ai = aiEnabled() ? await generateLibraryItems(texts) : null;
  if (ai && ai.length) {
    await db.insert(
      'content_library',
      ai.map((x) => ({ type: x.type, occasion: x.occasion, lang: 'ru', text: x.text, approved: false, source: 'ai' as const })),
    );
    return { added: ai.length, source: 'ai', message: `AI предложил ${ai.length} элементов — проверьте и одобрите` };
  }
  const known = new Set(texts.map((t) => t.toLowerCase()));
  const reserve = RESERVE_CONTENT.filter((x) => !known.has(x.text.toLowerCase())).slice(0, 20);
  if (reserve.length) {
    await db.insert(
      'content_library',
      reserve.map((x) => ({ ...x, lang: 'ru', approved: false, source: 'seed' as const })),
    );
  }
  return {
    added: reserve.length,
    source: 'reserve',
    message: aiEnabled()
      ? `AI сейчас недоступен — добавлено ${reserve.length} из резервного набора`
      : `Нет ANTHROPIC_API_KEY — добавлено ${reserve.length} из резервного набора`,
  };
}

export async function analytics() {
  const db = getDb();
  const now = Date.now();
  const [episodes, companies, members] = await Promise.all([db.select('episodes'), db.select('companies'), db.select('members')]);
  const weekAgo = now - 7 * 24 * 3600_000;
  const started = episodes.map((e) => ({ ...e, t0: Date.parse(e.started_at), t1: e.ended_at ? Date.parse(e.ended_at) : null }));

  const perCompany = new Map<string, number>();
  for (const e of started) perCompany.set(e.company_id, (perCompany.get(e.company_id) ?? 0) + 1);
  const withAny = [...perCompany.values()].filter((n) => n >= 1).length;
  const returning = [...perCompany.values()].filter((n) => n >= 2).length;

  const finished = started.filter((e) => e.status === 'finished' && e.t1);
  const durations = finished.map((e) => (e.t1 as number) - e.t0).filter((d) => d > 0);
  // «Закрытые» эпизоды: доиграны, брошены или зависли дольше 4 часов
  const closed = started.filter((e) => e.status !== 'active' || now - e.t0 > 4 * 3600_000);

  return {
    episodesWeek: started.filter((e) => e.t0 >= weekAgo).length,
    episodesTotal: started.length,
    companies: companies.length,
    players: members.length,
    returnRate: withAny ? returning / withAny : null,
    returning,
    withAny,
    avgLengthMin: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length / 60_000 : null,
    completion: closed.length ? finished.length / closed.length : null,
    finished: finished.length,
    closed: closed.length,
    byDay: Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(now - (6 - i) * 24 * 3600_000);
      dayStart.setHours(0, 0, 0, 0);
      const next = dayStart.getTime() + 24 * 3600_000;
      return { day: dayStart.toISOString(), count: started.filter((e) => e.t0 >= dayStart.getTime() && e.t0 < next).length };
    }),
  };
}
