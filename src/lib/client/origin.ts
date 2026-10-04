'use client';

/** Адрес сайта для QR-кодов и ссылок «поделиться». HTML-версия подменяет его адресом деплоя. */
export function pageOrigin(): string {
  return window.location.origin;
}
