// The demo shop's catalogue. The PayPal sandbox store has none, so this is invented: prices are Simulated demo.
// SKUs are letters and digits only: PayPal rejects "SKU-1042" as an evidence item_id (F-27).
export interface Product {
  sku: string;
  name: string;
  unitMinor: number; // USD cents
  weight: number; // relative popularity
}

export const CATALOGUE: readonly Product[] = [
  { sku: 'BP1001', name: 'Blue pottery vase, large', unitMinor: 6400, weight: 10 },
  { sku: 'BP1002', name: 'Dinner plate set of 4', unitMinor: 8900, weight: 8 },
  { sku: 'BP1003', name: 'Hand-painted mug, set of 2', unitMinor: 2800, weight: 22 },
  { sku: 'BP1004', name: 'Tea set with 6 cups', unitMinor: 11200, weight: 5 },
  { sku: 'BP1005', name: 'Decorative wall plate', unitMinor: 3600, weight: 15 },
  { sku: 'BP1006', name: 'Planter with stand', unitMinor: 4500, weight: 12 },
  { sku: 'BP1007', name: 'Soap dish and tray set', unitMinor: 1900, weight: 18 },
  { sku: 'BP1008', name: 'Serving bowl, medium', unitMinor: 4100, weight: 10 },
];

export const DEMO_COUNTRIES: readonly { code: string; weight: number }[] = [
  { code: 'US', weight: 45 },
  { code: 'GB', weight: 15 },
  { code: 'CA', weight: 10 },
  { code: 'AU', weight: 8 },
  { code: 'DE', weight: 8 },
  { code: 'AE', weight: 6 },
  { code: 'SG', weight: 4 },
  { code: 'FR', weight: 4 },
];
