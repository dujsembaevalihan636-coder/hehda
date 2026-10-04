import type { Metadata } from 'next';

import DemoHallClient from './demo-hall-client';

export const metadata: Metadata = { title: 'Демо: зал' };

export default function DemoHallPage() {
  return <DemoHallClient />;
}
