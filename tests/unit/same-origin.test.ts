import { describe, expect, it } from 'vitest';
import { rejectCrossOrigin } from '../../src/lib/same-origin';

const req = (h: Record<string, string>) => new Request('http://localhost:3000/api/x', { method: 'POST', headers: h });

describe('rejectCrossOrigin (writes and analyse routes)', () => {
  it('lets a same-origin browser request through', () => {
    expect(rejectCrossOrigin(req({ host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });
  it('lets a request with no Origin through (curl, server-side)', () => {
    expect(rejectCrossOrigin(req({ host: 'localhost:3000' }))).toBeNull();
  });
  it('rejects another origin', async () => {
    const r = rejectCrossOrigin(req({ host: 'localhost:3000', origin: 'https://evil.example' }));
    expect(r?.status).toBe(403);
    expect(await r?.json()).toEqual({ error: 'CROSS_ORIGIN' });
  });
  it('rejects a browser that says cross-site, even with a matching-looking origin', () => {
    expect(rejectCrossOrigin(req({ host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' }))?.status).toBe(403);
  });
  it('rejects a malformed Origin', () => {
    expect(rejectCrossOrigin(req({ host: 'localhost:3000', origin: 'null' }))?.status).toBe(403);
  });
});
