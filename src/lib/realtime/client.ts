'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { DATA_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import type { ChangeEvent } from '../db/types';
import type { TableName } from '../types';

// Единая подписка на изменения таблиц:
//  • режим supabase — Supabase Realtime (postgres_changes);
//  • локальный режим — одно SSE-соединение /api/realtime на страницу.
// Фильтр в синтаксисе Supabase: 'table_no=eq.7'.

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'offline';

let status: RealtimeStatus = 'idle';
let subscriptions = 0;
const statusListeners = new Set<() => void>();
function setStatus(s: RealtimeStatus) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}

let sb: SupabaseClient | null = null;
export function getBrowserSupabase(): SupabaseClient {
  if (!sb) {
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 30 } },
    });
  }
  return sb;
}

interface Listener {
  table: TableName;
  filter: { col: string; val: string } | null;
  cb: (c: ChangeEvent) => void;
}

const listeners = new Set<Listener>();
let es: EventSource | null = null;

function parseFilter(filter?: string | null): Listener['filter'] {
  if (!filter) return null;
  const m = /^([a-z_]+)=eq\.(.+)$/.exec(filter);
  return m ? { col: m[1], val: m[2] } : null;
}

function ensureSse() {
  if (es || typeof window === 'undefined') return;
  setStatus('connecting');
  es = new EventSource('/api/realtime');
  es.onopen = () => setStatus('live');
  es.onerror = () => setStatus('offline'); // EventSource переподключится сам
  es.onmessage = (m) => {
    let ch: ChangeEvent;
    try {
      ch = JSON.parse(m.data);
    } catch {
      return;
    }
    for (const l of listeners) {
      if (l.table !== ch.table) continue;
      if (l.filter) {
        const row = (ch.new ?? ch.old ?? {}) as Record<string, unknown>;
        if (String(row[l.filter.col]) !== l.filter.val) continue;
      }
      l.cb(ch);
    }
  };
}

export function subscribe(table: TableName, filter: string | null | undefined, cb: (c: ChangeEvent) => void) {
  subscriptions++;
  if (status === 'idle') setStatus('connecting');
  const done = () => {
    subscriptions = Math.max(0, subscriptions - 1);
    if (!subscriptions) setStatus('idle');
  };
  if (DATA_MODE === 'local') {
    const l: Listener = { table, filter: parseFilter(filter), cb };
    listeners.add(l);
    ensureSse();
    return () => {
      listeners.delete(l);
      if (!listeners.size && es) {
        es.close();
        es = null;
      }
      done();
    };
  }

  const client = getBrowserSupabase();
  const name = `rt-${table}-${filter ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = client
    .channel(name)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
      (payload) => {
        const next = payload.new && Object.keys(payload.new).length ? (payload.new as Record<string, unknown>) : null;
        const old = payload.old && Object.keys(payload.old).length ? (payload.old as Record<string, unknown>) : null;
        cb({ table, eventType: payload.eventType, new: next, old });
      },
    )
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') setStatus('live');
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('offline');
    });
  return () => {
    client.removeChannel(channel);
    done();
  };
}

/** Подписка на изменения таблицы. Колбэк всегда актуальный, переподписка только при смене table/filter. */
export function useRealtime<T = Record<string, unknown>>(
  table: TableName,
  filter: string | null | undefined,
  cb: (c: ChangeEvent<T>) => void,
  enabled = true,
) {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribe(table, filter, (c) => ref.current(c as ChangeEvent<T>));
  }, [table, filter, enabled]);
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
    () => 'idle',
  );
}
