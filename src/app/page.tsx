import Link from 'next/link';
import { BrandMark, ShopIcon } from '../components/icons';
import { TruthStateBadge } from '../components/truth-state-badge';

// The home page shows the product's core idea: a claim is sent only when our records back it.
// The example is Illustrative: no real case, order or amount.
function ExampleCheck() {
  return (
    <figure className="km-panel-raised w-full max-w-md" aria-labelledby="example-caption">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-navy-900">Checking a reply to a buyer&apos;s claim</p>
        <TruthStateBadge state="Illustrative" />
      </div>
      <ul className="mt-4 space-y-3 text-sm">
        <li className="border-l-4 border-emerald-600 pl-3">
          <p className="font-medium text-emerald-900">Backed by your records, so it is sent</p>
          <p className="mt-0.5 text-ink">Shipped with India Post; the tracking number is on file.</p>
        </li>
        <li className="border-l-4 border-red-600 pl-3">
          <p className="font-medium text-red-900">Not backed, so it is never sent</p>
          <p className="mt-0.5 text-ink">&ldquo;The buyer signed for the parcel.&rdquo; No signature record exists.</p>
        </li>
        <li className="border-l-4 border-slate-300 pl-3">
          <p className="font-medium text-muted">What the buyer wrote</p>
          <p className="mt-0.5 italic text-ink">My parcel has not arrived.</p>
        </li>
      </ul>
      <figcaption id="example-caption" className="mt-4 border-t border-line pt-3 text-xs text-muted">
        You approve the exact words before anything goes to PayPal.
      </figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2.5 text-[1.05rem] font-semibold tracking-tight">
            <BrandMark />
            KeepMore
          </span>
          <span className="text-xs text-navy-300">PayPal sandbox only</span>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-14 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="max-w-[16ch] text-[2.4rem] leading-[1.08] font-semibold tracking-tight text-navy-900 sm:text-[3.25rem]">
            Answer PayPal disputes with proof you can show.
          </h1>
          <p className="mt-4 max-w-[58ch] leading-relaxed text-muted">
            For Indian sellers who ship abroad. KeepMore checks every claim in a reply against your shipping and PayPal
            records, and shows what fees and exchange rates took from each sale.
          </p>
          <nav aria-label="Start" className="mt-8 flex flex-wrap gap-3">
            <Link href="/overview" className="km-btn-primary px-5 py-2.5 text-base">
              Overview
            </Link>
            <Link href="/disputes" className="km-btn-secondary px-5 py-2.5 text-base">
              Disputes
            </Link>
            <Link href="/store" className="km-btn-secondary px-5 py-2.5 text-base">
              <ShopIcon />
              Demo shop
            </Link>
          </nav>
        </div>
        <div className="flex justify-center lg:justify-end">
          <ExampleCheck />
        </div>
      </main>
    </div>
  );
}
