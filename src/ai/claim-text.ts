// A typed claim in plain words for the truth map (T-401). Money goes through fromMinor (CLAUDE.md).
import { fromMinor } from '../normalise/money';
import type { Claim } from './schema';

const words = (code: string) => code.replace(/_/g, ' ').toLowerCase();
const carrier = (code: string) => code.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

export function claimText(c: Claim): string {
  switch (c.type) {
    case 'SHIPPED':
      return `Shipped on ${c.date} with ${carrier(c.carrier)}, tracking number ${c.trackingNo}`;
    case 'DELIVERED':
      return `Tracking record shows delivered on ${c.date}`;
    case 'DELIVERED_TO_NEIGHBOUR':
      return `Tracking record shows delivered to a neighbour on ${c.date}`;
    case 'TRACKING_STATUS':
      return `Tracking status ${words(c.status)} on ${c.date}`;
    case 'ORDER_AMOUNT':
      return `Order total ${fromMinor(c.minor, c.currency)} ${c.currency}`;
    case 'CAPTURE_AMOUNT':
      return `PayPal captured ${fromMinor(c.minor, c.currency)} ${c.currency}`;
    case 'ORDER_COUNTRY':
      return `Shipping to ${c.country}`;
    case 'SELLER_PROTECTION':
      return `Seller protection: ${words(c.value)}`;
    case 'BUYER_SAID':
      return `The buyer wrote: “${c.quote}”`;
    case 'UNTYPED':
      return c.text;
  }
}
