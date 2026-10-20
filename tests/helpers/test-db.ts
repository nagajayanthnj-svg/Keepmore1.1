import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Clock, systemClock } from '../../src/lib/clock';
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

const STALE_MS = 60 * 60 * 1000;

/** Delete keepmore-test-* folders older than 1 hour. On Windows close() can leave them behind. */
export function sweepStaleTestDbs(clock: Clock = systemClock, root = tmpdir()): void {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('keepmore-test-')) continue;
      const dir = join(root, entry.name);
      try {
        if (clock().getTime() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
      } catch {
        // still locked or already gone: leave it for a later run
      }
    }
  } catch {
    // unreadable root: nothing to sweep
  }
}

let swept = false;

/** A fresh SQLite file with every migration applied. One per test file; close() deletes it. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!swept) {
    swept = true;
    sweepStaleTestDbs();
  }
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
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // libsql frees its native handle on garbage collection, not on close, and Windows will not
        // delete an open file. Leave the temp folder there rather than fail the suite.
        const code = (e as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY')) throw e;
      }
    },
  };
}
