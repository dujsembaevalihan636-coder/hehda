import type { Metadata } from 'next';

import { zoneOfTable } from '@/lib/hall-layout';
import { isZoneId } from '@/lib/zones';

import TableClient from './table-client';

export const metadata: Metadata = { title: 'Громко?' };

export default async function TablePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const table = sp.t && /^\d+$/.test(sp.t) ? Number(sp.t) : null;
  const z = sp.zone?.toUpperCase();
  const zone = isZoneId(z) ? z : table ? (zoneOfTable(table) ?? 'A') : 'A';
  return <TableClient zone={zone} table={table} />;
}
