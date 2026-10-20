// npm run db:seed        seeds the demo shop (no-op if already seeded)
// npm run db:reset-demo  removes demo rows and seeds again (needs DEMO_MODE=true)
import { existsSync } from 'node:fs';
import { resetDemo, seedDemo } from '../src/demo/seed';
import { createDb } from '../src/lib/db';

// Same as prisma.config.ts: read .env when there is one (CI has none).
if (existsSync('.env')) process.loadEnvFile('.env');

const db = createDb();
try {
  if (process.argv.includes('--reset')) await resetDemo(db, { demoMode: process.env.DEMO_MODE === 'true' });
  const { orders } = await seedDemo(db);
  console.log(orders === 0 ? 'Demo data already present.' : `Seeded ${orders} demo orders.`);
} finally {
  await db.$disconnect();
}
