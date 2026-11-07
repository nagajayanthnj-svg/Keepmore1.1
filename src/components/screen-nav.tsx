'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { contextFromLocation, screenLinks } from '../lib/screens';
import { DisputeIcon, OrderIcon, OutcomeIcon, OverviewIcon } from './icons';

const AREA: Record<string, string> = { overview: 'overview', orders: 'order', disputes: 'dispute', outcome: 'outcome' };
const ICON: Record<string, ReactNode> = {
  overview: <OverviewIcon />,
  order: <OrderIcon />,
  dispute: <DisputeIcon />,
  outcome: <OutcomeIcon />,
};

/** The four screens in order. The order and case ids in the URL are carried to every link. */
export function ScreenNav() {
  const pathname = usePathname();
  const query = useSearchParams();
  const current = AREA[pathname.split('/')[1] ?? ''];
  const links = screenLinks(contextFromLocation(pathname, new URLSearchParams(query.toString())));
  const item = 'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm';
  return (
    <nav aria-label="Screens">
      <ol className="flex gap-1 lg:flex-col">
        {links.map((l) => (
          <li key={l.key}>
            {l.href ? (
              <Link
                href={l.href}
                aria-current={l.key === current ? 'page' : undefined}
                className={`${item} ${
                  l.key === current
                    ? 'bg-white/10 font-medium text-white shadow-[inset_3px_0_0_var(--color-brand-600)]'
                    : 'text-navy-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                {ICON[l.key]}
                {l.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title="Open an order or a dispute first"
                className={`${item} cursor-not-allowed text-navy-300/50`}
              >
                {ICON[l.key]}
                {l.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
