import type { Metadata } from 'next';

import BookClient from './book-client';

export const metadata: Metadata = { title: 'Бронь стола' };

export default function BookPage() {
  return <BookClient />;
}
