import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { ScreenNav } from '../../components/screen-nav';

export default function ScreensLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          KeepMore
        </Link>
        <Suspense fallback={null}>
          <ScreenNav />
        </Suspense>
      </header>
      <main>{children}</main>
    </div>
  );
}
