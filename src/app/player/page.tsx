import type { Metadata } from 'next';

import { PlayerPanel } from '@/components/hall/PlayerPanel';
import { parseZone } from '@/lib/zones';

export const metadata: Metadata = { title: 'Колонки зоны' };

export default async function PlayerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const zone = parseZone((await searchParams).zone);
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col p-4 sm:p-8">
      <PlayerPanel zone={zone} />
    </main>
  );
}
