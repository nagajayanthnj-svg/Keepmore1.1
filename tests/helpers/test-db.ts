import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '../../src/lib/db';

const MIGRATIONS = join(import.meta.dirname, '../../prisma/migrations');

/** Split a migration file into statements. Triggers contain ';' inside BEGIN ... END. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  for (const line of sql.split('\n')) {
    if (/^\s*--/.test(line)) continue;
    current += `${line}\n`;
    if (/\bBEGIN\b/i.test(line)) depth++;
    if (/^\s*END\s*;/i.test(line)) depth--;
    if (depth === 0 && line.trim().endsWith(';')) {
      out.push(current.trim());
      current = '';
    }
  }
  return out;
}

/** A fresh SQLite file with every migration applied. One per test file; close() deletes it. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'keepmore-test-'));
  const db = createDb(`file:${join(dir, 'test.db')}`);
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const folder of folders) {
    for (const stmt of statements(readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8'))) {
      await db.$executeRawUnsafe(stmt);
    }
  }
  return {
    db,
    close: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
