import type { Metadata } from 'next';

import { parseZone } from '@/lib/zones';

import SensorClient from './sensor-client';

export const metadata: Metadata = { title: 'Датчик' };

export default async function SensorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const zone = parseZone(sp.zone);
  const table = sp.t && /^\d+$/.test(sp.t) ? Number(sp.t) : null;
  return <SensorClient zone={zone} table={table} />;
}
