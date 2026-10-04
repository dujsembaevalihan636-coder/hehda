import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Зал, где слышно друг друга · Table Mode',
    template: '%s · Зал, где слышно друг друга',
  },
  description:
    'Ресторан, который держит комфортный уровень шума по зонам, и игровой слой для стола: QR → общая комната → эпизод сезона вашей компании.',
};

export const viewport: Viewport = {
  themeColor: '#110d0b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
