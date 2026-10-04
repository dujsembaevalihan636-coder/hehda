'use client';

import { useEffect, useRef, useState } from 'react';

/** Периодический вызов fn: сразу после монтирования и затем каждые ms миллисекунд. */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      void ref.current();
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ms, enabled]);
}

/** Текущее время, обновляемое по таймеру (без вызова Date.now() во время рендера). 0 — до первого тика. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  usePolling(() => setNow(Date.now()), ms);
  return now;
}
