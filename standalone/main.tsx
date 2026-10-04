import { createRoot } from 'react-dom/client';

import { App } from './app';
import { installRuntime } from './runtime';
import { bootVirtualHall } from './virtual-hall';

// Точка входа HTML-версии: сначала «сервер» в этой вкладке, потом виртуальный зал, потом страницы.

installRuntime();
document.documentElement.lang = 'ru';
document.body.classList.add('antialiased');

const root = createRoot(document.getElementById('root') as HTMLElement);
bootVirtualHall()
  .catch((e) => console.error('[виртуальный зал]', e))
  .finally(() => root.render(<App />));
