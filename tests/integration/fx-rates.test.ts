import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFxRates, parseFxCsv, rateOnOrBefore } from '../../src/ledger/fx-rates';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

describe('parseFxCsv', () => {
  it('parses date,pair,rate rows', () => {
    const rows = parseFxCsv('date,pair,rate\n2026-10-19,USD/INR,84.1234\n2026-10-16,USD/INR,83.9\n');
    expect(rows).toEqual([
      { date: new Date('2026-10-19T00:00:00Z'), pair: 'USD/INR', rate: '84.1234' },
      { date: new Date('2026-10-16T00:00:00Z'), pair: 'USD/INR', rate: '83.9' },
    ]);
  });
  it('accepts CRLF line endings and a trailing blank line', () => {
    expect(parseFxCsv('date,pair,rate\r\n2026-10-19,USD/INR,84\r\n\r\n')).toHaveLength(1);
  });
  it.each([
    ['wrong header', 'day,pair,rate\n2026-10-19,USD/INR,84'],
    ['bad date', 'date,pair,rate\n19-10-2026,USD/INR,84'],
    ['impossible date', 'date,pair,rate\n2026-02-30,USD/INR,84'],
    ['bad pair', 'date,pair,rate\n2026-10-19,USDINR,84'],
    ['zero rate', 'date,pair,rate\n2026-10-19,USD/INR,0'],
    ['negative rate', 'date,pair,rate\n2026-10-19,USD/INR,-84'],
    ['non-numeric rate', 'date,pair,rate\n2026-10-19,USD/INR,eighty'],
    ['missing column', 'date,pair,rate\n2026-10-19,USD/INR'],
    ['no rows', 'date,pair,rate\n'],
  ])('rejects %s and names the line', (_n, csv) => {
    expect(() => parseFxCsv(csv)).toThrow(/line|header|rows/i);
  });
});

describe('FxRate table', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  const csv = 'date,pair,rate\n2026-10-16,USD/INR,83.9000\n2026-10-19,USD/INR,84.1234\n';

  it('loads rows, and loading the same file twice changes nothing', async () => {
    expect(await loadFxRates(db, parseFxCsv(csv), 'FBIL')).toBe(2);
    expect(await loadFxRates(db, parseFxCsv(csv), 'FBIL')).toBe(0);
    expect(await db.fxRate.count()).toBe(2);
  });

  it('refuses to silently change a stored rate', async () => {
    await expect(loadFxRates(db, parseFxCsv('date,pair,rate\n2026-10-19,USD/INR,99'), 'FBIL')).rejects.toThrow(
      /differs/,
    );
  });

  it('finds the latest rate on or before a date, so weekends use Friday', async () => {
    const sat = await rateOnOrBefore(db, 'USD/INR', new Date('2026-10-17T10:00:00Z'), { source: 'FBIL' });
    expect(sat).toEqual({ rate: '83.9', date: new Date('2026-10-16T00:00:00Z') });
    const mon = await rateOnOrBefore(db, 'USD/INR', new Date('2026-10-19T23:59:00Z'), { source: 'FBIL' });
    expect(mon?.rate).toBe('84.1234');
  });

  it('returns undefined before the first rate and when the rate is older than the limit', async () => {
    expect(await rateOnOrBefore(db, 'USD/INR', new Date('2026-10-01T00:00:00Z'), { source: 'FBIL' })).toBeUndefined();
    expect(
      await rateOnOrBefore(db, 'USD/INR', new Date('2026-11-30T00:00:00Z'), { source: 'FBIL', maxAgeDays: 7 }),
    ).toBeUndefined();
  });
});
