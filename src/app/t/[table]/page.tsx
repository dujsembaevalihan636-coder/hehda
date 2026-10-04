import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { zoneOfTable } from '@/lib/hall-layout';

import GameClient from './game-client';

export const metadata: Metadata = { title: 'Table Mode' };

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { table } = await params;
  const n = Number(table);
  if (!Number.isInteger(n) || n < 1 || n > 999) notFound();
  const sp = await searchParams;
  const slot = sp.slot && /^[\w-]{1,12}$/.test(sp.slot) ? sp.slot : null;
  const autoName = sp.name ? sp.name.slice(0, 24) : null;
  return <GameClient table={n} zone={zoneOfTable(n)} slot={slot} autoName={autoName} embedded={sp.embed === '1'} />;
}
