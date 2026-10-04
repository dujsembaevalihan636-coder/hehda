'use client';

import GameClient from '@/app/t/[table]/game-client';
import { zoneOfTable } from '@/lib/hall-layout';

// Экран «телефона» в демо Table Mode без iframe: та же игра стола, но прямо в рамке.
// .phone-screen создаёт свой контекст для position: fixed (тосты), .phone-scroll — свою прокрутку.

export function PhoneScreen({ table, slot, name }: { table: number; slot: string; name: string }) {
  return (
    <div className="phone-screen" role="region" aria-label={`Телефон ${name}`}>
      <div className="phone-scroll">
        <GameClient table={table} zone={zoneOfTable(table)} slot={slot} autoName={name} embedded />
      </div>
    </div>
  );
}
