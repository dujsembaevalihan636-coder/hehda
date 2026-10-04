// next/navigation для серверных страниц: redirect/notFound бросают сигнал, роутер его ловит.

export class RedirectSignal extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super('not found');
  }
}

export function redirect(to: string): never {
  throw new RedirectSignal(to);
}

export function notFound(): never {
  throw new NotFoundSignal();
}
