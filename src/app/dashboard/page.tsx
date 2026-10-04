import type { Metadata } from 'next';

import DashboardClient from './dashboard-client';

export const metadata: Metadata = { title: 'Панель менеджера' };

export default function DashboardPage() {
  return <DashboardClient />;
}
