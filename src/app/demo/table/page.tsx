import type { Metadata } from 'next';

import DemoTableClient from './demo-table-client';

export const metadata: Metadata = { title: 'Демо: Table Mode' };

export default function DemoTablePage() {
  return <DemoTableClient />;
}
