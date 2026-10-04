import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isAdmin } from '@/lib/server/admin-auth';

import QrSheet from './qr-sheet';

export const metadata: Metadata = { title: 'QR-карточки столов' };

export default async function QrPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAdmin())) redirect('/admin');
  const sp = await searchParams;
  const from = Math.max(1, Number(sp.from ?? 1) || 1);
  const to = Math.min(from + 23, Math.max(from, Number(sp.to ?? 12) || 12));
  return <QrSheet from={from} to={to} />;
}
