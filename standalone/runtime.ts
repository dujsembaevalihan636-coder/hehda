import { z } from 'zod';

import { getLocalDb, PUBLIC_TABLES, type ChangeEvent } from '@/lib/db';

import { handleApi } from './api-routes';
import { randomUUID } from './shims/node-crypto';

// Среда HTML-версии: fetch('/api/…') уходит в route handlers этой же вкладки,
// EventSource('/api/realtime') слушает шину локальной базы. Остальные запросы — как обычно.

export type HtmlMode = 'artifact' | 'file';

/** 'artifact' — страница в превью claude.ai (нет печати и микрофона), 'file' — HTML-файл в браузере. */
export const HTML_MODE: HtmlMode = (window as { __HEHDA_HTML__?: string }).__HEHDA_HTML__ === 'artifact' ? 'artifact' : 'file';

const LOCAL_ORIGIN = 'http://hehda.local';

function localPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('/')) return raw;
  try {
    const u = new URL(raw);
    if (u.origin === LOCAL_ORIGIN || u.origin === window.location.origin) return u.pathname + u.search;
  } catch {
    /* не URL */
  }
  return null;
}

/** Изменения публичных таблиц — как SSE-поток /api/realtime, но без сети. */
class LocalEventSource extends EventTarget {
  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    const db = getLocalDb();
    const onChange = (ev: ChangeEvent) => {
      if (!PUBLIC_TABLES.includes(ev.table)) return;
      const data = JSON.stringify(ev);
      // Как по сети: доставка после завершения текущего запроса к «серверу»
      setTimeout(() => {
        if (this.readyState === 1) this.fire('message', new MessageEvent('message', { data }));
      }, 0);
    };
    db?.bus.on('change', onChange);
    this.unsubscribe = () => db?.bus.off('change', onChange);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.fire('open', new Event('open'));
    }, 0);
  }

  private fire(type: 'open' | 'message', ev: Event) {
    this.dispatchEvent(ev);
    if (type === 'open') this.onopen?.(ev);
    else this.onmessage?.(ev as MessageEvent);
  }

  close() {
    this.readyState = 2;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent('hehda:toast', { detail: text }));
}

export function installRuntime() {
  // Без JIT на new Function: строгий CSP превью запрещает eval, zod работает и так
  z.config({ jitless: true });

  if (typeof Response.json !== 'function') {
    Response.json = (data: unknown, init: ResponseInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(data), { ...init, headers });
    };
  }
  if (typeof crypto.randomUUID !== 'function') {
    Object.defineProperty(crypto, 'randomUUID', { value: randomUUID, configurable: true });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = localPath(input);
    if (path?.startsWith('/api/')) return handleApi(new Request(LOCAL_ORIGIN + path, init));
    if (path?.startsWith('/music/manifest.json')) return Response.json({ slow: [], mid: [], fast: [] });
    return nativeFetch(input, init);
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = function EventSource(url: string | URL, init?: EventSourceInit) {
    return localPath(url) === '/api/realtime' ? new LocalEventSource(String(url)) : new NativeEventSource(url, init);
  } as unknown as typeof window.EventSource;

  // В превью claude.ai диалог печати не открывается — объясняем вместо молчания
  if (HTML_MODE === 'artifact') {
    try {
      window.print = () => toast('В превью печать недоступна: откройте HTML-файл в браузере и печатайте оттуда');
    } catch {
      /* print только для чтения */
    }
  }
}
