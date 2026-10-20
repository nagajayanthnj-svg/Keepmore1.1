'use client';

import { useEffect, useRef, useState } from 'react';
import { CATALOGUE } from '../../demo/catalogue';
import { fromMinor } from '../../normalise/money';

interface PayPalButtons {
  render(el: HTMLElement): Promise<void>;
}
interface PayPalSdk {
  Buttons(opts: {
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onClick?(data: unknown, actions: { resolve(): Promise<void>; reject(): Promise<void> }): Promise<void>;
    onError?(err: unknown): void;
  }): PayPalButtons;
}
declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

const usd = (minor: number) => `$${fromMinor(minor, 'USD')}`; // the shop sells in USD only

type Result = { kind: 'ok'; text: string } | { kind: 'error'; text: string } | null;

export function Storefront({ clientId }: { clientId: string }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result>(null);
  const [sdkError, setSdkError] = useState<string | null>(clientId ? null : 'NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set');
  const box = useRef<HTMLDivElement>(null);
  const cart = useRef<{ sku: string; qty: number }[]>([]);

  const items = CATALOGUE.filter((p) => (qty[p.sku] ?? 0) > 0).map((p) => ({ sku: p.sku, qty: qty[p.sku]! }));
  useEffect(() => {
    cart.current = items;
  });
  // Display only. The server prices the cart again from the SKUs.
  const totalMinor = items.reduce((s, i) => s + i.qty * CATALOGUE.find((p) => p.sku === i.sku)!.unitMinor, 0);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !window.paypal || !box.current || box.current.childElementCount > 0) return;
      window.paypal
        .Buttons({
          async onClick(_d, actions) {
            return cart.current.length > 0 ? actions.resolve() : actions.reject();
          },
          async createOrder() {
            const res = await fetch('/api/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: cart.current }),
            });
            const body = (await res.json()) as { id?: string };
            if (!res.ok || !body.id) throw new Error('Could not create the order');
            return body.id;
          },
          async onApprove(data) {
            const res = await fetch(`/api/orders/${encodeURIComponent(data.orderID)}/capture`, { method: 'POST' });
            const body = (await res.json()) as { captureId?: string; grossMinor?: number; currency?: string };
            setResult(
              res.ok && body.captureId
                ? {
                    kind: 'ok',
                    text: `Paid ${usd(body.grossMinor!)}. Capture ${body.captureId}.`,
                  }
                : { kind: 'error', text: 'The payment could not be completed.' },
            );
          },
          onError() {
            setResult({ kind: 'error', text: 'PayPal reported an error.' });
          },
        })
        .render(box.current)
        .catch(() => setSdkError('The PayPal buttons could not be shown'));
    };
    if (window.paypal) mount();
    else {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
      s.onload = mount;
      s.onerror = () => setSdkError('The PayPal script could not be loaded');
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Neel Pottery</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Simulated demo shop. Prices are Simulated demo; payments use the PayPal sandbox only.
      </p>
      <ul className="mt-6 divide-y divide-neutral-200 rounded border border-neutral-200">
        {CATALOGUE.map((p) => (
          <li key={p.sku} className="flex items-center justify-between gap-4 p-3" data-sku={p.sku}>
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-neutral-600">
                {p.sku} · {usd(p.unitMinor)}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              Qty
              <input
                type="number"
                min={0}
                max={10}
                value={qty[p.sku] ?? 0}
                onChange={(e) =>
                  setQty({ ...qty, [p.sku]: Math.max(0, Math.min(10, Math.trunc(Number(e.target.value) || 0))) })
                }
                className="w-16 rounded border border-neutral-300 px-2 py-1"
                aria-label={`Quantity of ${p.name}`}
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-lg font-medium">Total</span>
        <span className="text-lg font-semibold" data-testid="cart-total">
          {usd(totalMinor)}
        </span>
      </div>
      {sdkError ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {sdkError}
        </p>
      ) : null}
      <div ref={box} className="mt-4" data-testid="paypal-buttons" />
      {result ? (
        <p role="status" className={`mt-4 text-sm ${result.kind === 'ok' ? 'text-green-800' : 'text-red-700'}`}>
          {result.text}
        </p>
      ) : null}
    </main>
  );
}
