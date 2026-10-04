'use client';

// Экран одного «телефона» в демо Table Mode: настоящая страница стола в iframe.
// HTML-версия (standalone/) подменяет этот модуль и рисует игру прямо в рамке, без iframe.

export function PhoneScreen({ table, slot, name }: { table: number; slot: string; name: string }) {
  return (
    <iframe
      title={`Телефон ${name}`}
      src={`/t/${table}?slot=${slot}&name=${encodeURIComponent(name)}&embed=1`}
      className="h-full w-full"
    />
  );
}
