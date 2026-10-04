import { SEED_CONTENT } from '../game/content-seed';
import { HALL_TABLES } from '../hall-layout';
import type { ContentItem, HallTable, Room, Zone } from '../types';
import { ZONES, ZONE_IDS } from '../zones';

// Единый источник сид-данных: и для локального режима, и для генерации supabase/seed.sql.

export const SEED_ROOM_TABLES = Array.from({ length: 12 }, (_, i) => i + 1);

export function seedZones(now = new Date().toISOString()): Zone[] {
  return ZONE_IDS.map((id) => {
    const z = ZONES[id];
    return {
      id,
      name: z.name,
      target_min_db: z.targetMin,
      target_max_db: z.targetMax,
      music_volume: z.defaultVolume,
      tempo: z.defaultTempo,
      auto_mode: true,
      control_state: 'ok',
      state_since: null,
      above_since: null,
      last_change_at: null,
      last_tempo_change_at: null,
      music_ref_db: z.musicRefDb,
      music_ref_volume: z.musicRefVolume,
      version: 0,
      updated_at: now,
    };
  });
}

export function seedHallTables(): HallTable[] {
  return HALL_TABLES.map((t) => ({ ...t }));
}

export function seedRooms(now = new Date().toISOString()): Room[] {
  return SEED_ROOM_TABLES.map((table_no) => ({
    table_no,
    current_episode_id: null,
    phase: 'idle',
    state: {},
    version: 0,
    updated_at: now,
  }));
}

export function seedContent(now = new Date().toISOString()): ContentItem[] {
  return SEED_CONTENT.map((c) => ({
    id: c.id,
    type: c.type,
    occasion: c.occasion,
    lang: 'ru',
    text: c.text,
    approved: true,
    source: 'seed',
    created_at: now,
  }));
}
