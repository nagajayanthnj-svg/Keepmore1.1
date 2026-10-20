import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/lib/clock';
import { sweepStaleTestDbs } from '../helpers/test-db';

const root = mkdtempSync(join(tmpdir(), 'keepmore-sweep-root-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('sweepStaleTestDbs', () => {
  it('deletes keepmore-test-* folders older than 1 hour and nothing else', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    const make = (name: string, ageMs: number) => {
      const dir = join(root, name);
      mkdirSync(dir);
      const t = new Date(now.getTime() - ageMs);
      utimesSync(dir, t, t);
      return dir;
    };
    const old = make('keepmore-test-old', 61 * 60 * 1000);
    const fresh = make('keepmore-test-fresh', 59 * 60 * 1000);
    const other = make('someone-else-old', 24 * 60 * 60 * 1000);

    sweepStaleTestDbs(fixedClock(now.toISOString()), root);

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('ignores a folder it cannot read', () => {
    expect(() => sweepStaleTestDbs(fixedClock('2026-10-20T12:00:00Z'), join(root, 'missing'))).not.toThrow();
  });
});
