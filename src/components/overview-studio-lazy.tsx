'use client';
// AG Studio draws in the browser only, so it is loaded without server rendering.
import dynamic from 'next/dynamic';

export const OverviewStudioLazy = dynamic(() => import('./overview-studio').then((m) => m.OverviewStudio), {
  ssr: false,
  loading: () => (
    <p role="status" className="rounded border border-neutral-300 p-3 text-sm">
      Loading the dashboard…
    </p>
  ),
});
