'use client';

import { useState } from 'react';

import { HeardQuestion } from '@/components/hall/HeardQuestion';
import type { ZoneId } from '@/lib/types';
import { ZONES } from '@/lib/zones';

export default function FeedbackClient({ zone, table }: { zone: ZoneId; table: number | null }) {
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10 text-center">
      <p className="mb-6 text-sm text-faint">
        {ZONES[zone].title}
        {table ? ` · стол ${table}` : ''}
      </p>
      <HeardQuestion zone={zone} table={table} big onDone={() => setDone(true)} />
      {done ? <p className="mt-10 text-sm text-faint">Можно закрыть страницу</p> : null}
    </main>
  );
}
