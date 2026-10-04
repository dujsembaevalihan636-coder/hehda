'use client';

import { useCallback, useEffect, useState } from 'react';

import { useRealtime } from '../realtime/client';
import type { Zone } from '../types';
import { api } from './api';

const norm = (z: Zone): Zone => ({
  ...z,
  music_volume: Number(z.music_volume),
  target_min_db: Number(z.target_min_db),
  target_max_db: Number(z.target_max_db),
});

/** Зоны с realtime-обновлениями и страховочным опросом (если realtime недоступен). */
export function useZones(pollMs = 10_000) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const merge = useCallback((incoming: Zone[]) => {
    setZones((prev) => {
      if (!prev) return incoming.map(norm);
      return incoming.map((z) => {
        const cur = prev.find((p) => p.id === z.id);
        return cur && cur.version > z.version ? cur : norm(z);
      });
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ zones: Zone[] }>('/api/zones');
      merge(d.zones);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [merge]);

  useEffect(() => {
    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  useRealtime<Zone>('zones', null, (c) => {
    if (!c.new) return;
    const z = norm(c.new);
    setZones((prev) => {
      if (!prev) return prev;
      return prev.map((p) => (p.id === z.id && z.version >= p.version ? z : p));
    });
  });

  return { zones, error, reload: load, merge };
}
