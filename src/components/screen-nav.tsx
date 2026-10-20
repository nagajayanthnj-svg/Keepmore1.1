'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { contextFromLocation, screenLinks } from '../lib/screens';

const AREA: Record<string, string> = { overview: 'overview', orders: 'order', disputes: 'dispute', outcome: 'outcome' };

/** The four screens in order. The order and case ids in the URL are carried to every link. */
export function ScreenNav() {
  const pathname = usePathname();
  const query = useSearchParams();
  const current = AREA[pathname.split('/')[1] ?? ''];
  const links = screenLinks(contextFromLocation(pathname, new URLSearchParams(query.toString())));
  return (
    <nav aria-label="Screens">
      <ol className="flex gap-1 text-sm">
        {links.map((l) => (
          <li key={l.key}>
            {l.href ? (
              <Link
                href={l.href}
                aria-current={l.key === current ? 'page' : undefined}
                className={`block rounded px-3 py-1.5 ${l.key === current ? 'bg-neutral-900 text-white' : 'text-neutral-800 hover:bg-neutral-200'}`}
              >
                {l.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title="Open an order or a dispute first"
                className="block cursor-not-allowed rounded px-3 py-1.5 text-neutral-500"
              >
                {l.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
