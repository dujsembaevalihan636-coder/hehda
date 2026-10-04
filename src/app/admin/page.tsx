import type { Metadata } from 'next';

import { isAdmin } from '@/lib/server/admin-auth';

import AdminClient from './admin-client';

export const metadata: Metadata = { title: 'Админка Table Mode' };

export default async function AdminPage() {
  return <AdminClient authed={await isAdmin()} />;
}
