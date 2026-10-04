import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { navigate, parseHref, toToken } from '../router';

// next/link для HTML-версии: внутренние ссылки переключают страницу без перезагрузки.

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

const NEXT_ONLY = ['prefetch', 'replace', 'scroll'] as const;

export default function Link(props: LinkProps) {
  const { href, onClick, children, ...rest } = props;
  const anchor: AnchorHTMLAttributes<HTMLAnchorElement> = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !(NEXT_ONLY as readonly string[]).includes(k)),
  );

  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={onClick} {...anchor}>
        {children}
      </a>
    );
  }

  return (
    <a
      href={`#${toToken(parseHref(href))}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
      {...anchor}
    >
      {children}
    </a>
  );
}
