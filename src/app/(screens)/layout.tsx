import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { BrandMark, ShopIcon } from '../../components/icons';
import { ScreenNav } from '../../components/screen-nav';

export default function ScreensLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <header className="sticky top-0 z-20 flex flex-col bg-navy-900 text-white lg:h-screen">
        <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-5 lg:py-6">
          <Link href="/" className="flex items-center gap-2.5 text-[1.05rem] font-semibold tracking-tight">
            <BrandMark />
            KeepMore
          </Link>
          <Link href="/store" className="flex items-center gap-1.5 text-sm text-navy-300 hover:text-white lg:hidden">
            <ShopIcon />
            Demo shop
          </Link>
        </div>
        <div className="overflow-x-auto px-2 pb-2 lg:flex-1 lg:overflow-visible lg:px-3 lg:pb-0">
          <Suspense fallback={null}>
            <ScreenNav />
          </Suspense>
        </div>
        <div className="hidden space-y-4 border-t border-navy-800 px-5 py-5 text-sm lg:block">
          <Link href="/store" className="flex items-center gap-2 text-navy-300 hover:text-white">
            <ShopIcon />
            Demo shop
          </Link>
          <p className="rounded-lg bg-navy-950 px-3 py-2 text-xs leading-relaxed text-navy-300">
            PayPal sandbox only. No real money moves.
          </p>
        </div>
      </header>
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
