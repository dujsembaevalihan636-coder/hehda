import type { Metadata } from 'next';

import { zoneOfTable } from '@/lib/hall-layout';
import { isZoneId } from '@/lib/zones';

import FeedbackClient from './feedback-client';

export const metadata: Metadata = { title: 'Было слышно?' };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const table = sp.t && /^\d+$/.test(sp.t) ? Number(sp.t) : null;
  const z = sp.zone?.toUpperCase();
  const zone = isZoneId(z) ? z : table ? (zoneOfTable(table) ?? 'A') : 'A';
  return <FeedbackClient zone={zone} table={table} />;
}
