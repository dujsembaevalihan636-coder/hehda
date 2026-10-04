'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { t } from '@/lib/i18n';

// Подтверждение прямо на странице вместо window.confirm: системные диалоги не показываются
// во встроенных браузерах и превью, а здесь вопрос и «Да» появляются на месте кнопки.

export function ConfirmButton({
  question,
  confirmLabel = t.common.confirmYes,
  onConfirm,
  className,
  disabled,
  children,
}: {
  question: string;
  confirmLabel?: string;
  onConfirm: () => unknown;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);

  // Вопрос без ответа сам закрывается через 8 секунд
  useEffect(() => {
    if (!asking) return;
    const id = setTimeout(() => setAsking(false), 8000);
    return () => clearTimeout(id);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} disabled={disabled} className={className}>
        {children}
      </button>
    );
  }
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink">{question}</span>
      <button
        type="button"
        autoFocus
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
        className="rounded-full bg-bad px-3 py-1 font-semibold text-white"
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="rounded-full border border-line px-3 py-1 text-muted">
        {t.common.cancel}
      </button>
    </span>
  );
}
