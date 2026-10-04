import { useSyncExternalStore } from 'react';

// Роутер HTML-версии: страница одна, адрес живёт в состоянии и в простом #якоре.
// В ссылку артефакта проходит только #токен без «=» и «?», поэтому
// '/sensor?zone=B' ↔ '#sensor~zone.B', '/demo/hall' ↔ '#demo-hall', '/' ↔ '#home'.

export interface Loc {
  path: string;
  query: Record<string, string>;
}

const SAFE = /^[\w-]+$/;

export function parseHref(href: string): Loc {
  const [p, q = ''] = href.split('?');
  return {
    path: '/' + p.split('/').filter(Boolean).join('/'),
    query: Object.fromEntries(new URLSearchParams(q)),
  };
}

export function toToken(loc: Loc): string {
  const base = loc.path === '/' ? 'home' : loc.path.slice(1).split('/').join('-');
  const query = Object.entries(loc.query)
    .filter(([k, v]) => SAFE.test(k) && SAFE.test(v))
    .map(([k, v]) => `~${k}.${v}`)
    .join('');
  return base + query;
}

export function fromToken(hash: string): Loc | null {
  const token = hash.replace(/^#/, '');
  if (!token) return null;
  const [base, ...pairs] = token.split('~');
  if (!/^[\w-]*$/.test(base)) return null;
  const query: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf('.');
    if (i > 0) query[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { path: !base || base === 'home' ? '/' : '/' + base.split('-').join('/'), query };
}

function readHash(): Loc {
  try {
    return fromToken(window.location.hash) ?? { path: '/', query: {} };
  } catch {
    return { path: '/', query: {} };
  }
}

let current: Loc = readHash();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function navigate(href: string) {
  current = parseHref(href);
  try {
    const token = toToken(current);
    if (window.location.hash.slice(1) !== token) window.location.hash = token;
  } catch {
    /* рамка не даёт менять адрес — хватает состояния */
  }
  notify();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const next = readHash();
  if (toToken(next) === toToken(current)) return;
  current = next;
  notify();
});

export function useLocation(): Loc {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
