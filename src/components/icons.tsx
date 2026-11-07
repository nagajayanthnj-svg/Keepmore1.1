// Small line icons for the app shell. Decorative only: every one sits next to its text label.
import type { ReactNode } from 'react';

const Svg = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg
    aria-hidden="true"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

/** A ledger page with a kept tick: money in, kept. */
export const BrandMark = () => (
  <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4v16" />
      <path d="M6 12l7-8" />
      <path d="M10 13l3.5 3.5L20 9" />
    </svg>
  </span>
);

export const OverviewIcon = () => (
  <Svg>
    <path d="M4 19V9" />
    <path d="M10 19V5" />
    <path d="M16 19v-7" />
    <path d="M3 21h18" />
  </Svg>
);
export const OrderIcon = () => (
  <Svg>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5 12 12l8.5-4.5" />
    <path d="M12 12v9" />
  </Svg>
);
export const DisputeIcon = () => (
  <Svg>
    <path d="M12 3v18" />
    <path d="M7 21h10" />
    <path d="M5 7h14" />
    <path d="M5 7l-3 6a3 3 0 0 0 6 0z" />
    <path d="M19 7l-3 6a3 3 0 0 0 6 0z" />
  </Svg>
);
export const OutcomeIcon = () => (
  <Svg>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </Svg>
);
export const ShopIcon = () => (
  <Svg size={16}>
    <path d="M5 8h14l-1 12H6z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Svg>
);
