'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { pageOrigin } from '@/lib/client/origin';

/** QR-код в SVG. value может быть относительным путём — тогда добавляется origin страницы. */
export function QrCode({ value, size = 160, className = '' }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState(value);

  useEffect(() => {
    const full = value.startsWith('http') ? value : `${pageOrigin()}${value}`;
    let alive = true;
    QRCode.toString(full, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1b1512', light: '#ffffff' } })
      .then((s) => {
        if (!alive) return;
        setSvg(s);
        setUrl(full);
      })
      .catch(() => setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div className={className}>
      <div
        className="overflow-hidden rounded-xl bg-white p-1.5"
        style={{ width: size, height: size }}
        aria-label={`QR: ${url}`}
        role="img"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );
}

export function useOrigin() {
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin известен только в браузере
    setOrigin(pageOrigin());
  }, []);
  return origin;
}
