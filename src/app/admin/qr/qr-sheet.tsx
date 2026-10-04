'use client';

import Link from 'next/link';

import { QrCode, useOrigin } from '@/components/ui/QrCode';
import { t } from '@/lib/i18n';

// Лист A4 для печати: 12 карточек 3×4, каждая — QR на /t/N.

export default function QrSheet({ from, to }: { from: number; to: number }) {
  const origin = useOrigin();
  const tables = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <main className="mx-auto max-w-[210mm] p-4 print:p-0">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.admin.qr}</h1>
          <p className="text-sm text-muted">
            Ссылки ведут на {origin || '…'}/t/N — печатайте с того адреса, где будет работать сервис (Vercel).
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="rounded-full border border-line px-4 py-2 text-sm text-muted">
            ← Админка
          </Link>
          <button onClick={() => window.print()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            🖨 {t.admin.print}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-[4mm] print:gap-[3mm]">
        {tables.map((n) => (
          <div
            key={n}
            className="flex flex-col items-center justify-between rounded-[4mm] border-2 border-dashed border-[#c9b8a8] bg-[#fffaf4] p-[4mm] text-center text-[#1b1512]"
            style={{ height: '66mm', breakInside: 'avoid' }}
          >
            <div>
              <p className="text-[9pt] font-bold uppercase tracking-[0.25em] text-[#c26a1c]">Table Mode</p>
              <p className="text-[20pt] leading-tight font-black">Стол {n}</p>
            </div>
            <QrCode value={`/t/${n}`} size={118} />
            <div>
              <p className="text-[9pt] leading-tight font-semibold">{t.admin.scan}</p>
              <p className="text-[7.5pt] leading-tight text-[#6b5a4c]">🔊 «Громко?» — тоже здесь</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
