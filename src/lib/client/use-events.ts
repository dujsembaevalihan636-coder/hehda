'use client';

import { useCallback, useEffect, useState } from 'react';

import { useRealtime } from '../realtime/client';
import type { HallEvent, ZoneId } from '../types';
import { api } from './api';

/** Лента событий зала (или одной зоны) с realtime-добавлением новых. */
export function useHallEvents(zone: ZoneId | null, limit = 40) {
  const [events, setEvents] = useState<HallEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api<{ events: HallEvent[] }>(`/api/events?limit=${limit}${zone ? `&zone=${zone}` : ''}`);
      setEvents((prev) => mergeEvents(prev, d.events, limit));
    } catch {
      /* попробуем на следующем цикле */
    }
  }, [zone, limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  useRealtime<HallEvent>('events', zone ? `zone_id=eq.${zone}` : null, (c) => {
    if (c.eventType === 'INSERT' && c.new) setEvents((prev) => mergeEvents(prev, [c.new as HallEvent], limit));
  });

  return { events, reload: load };
}

export function mergeEvents(prev: HallEvent[], incoming: HallEvent[], limit: number): HallEvent[] {
  const map = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) map.set(e.id, e);
  return [...map.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
}
