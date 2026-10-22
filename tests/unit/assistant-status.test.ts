import { describe, expect, it } from 'vitest';
import { assistantStatus } from '../../src/overview/assistant-status';

describe('why the AI assistant button is or is not usable', () => {
  it('ready with a model and demo data', () => expect(assistantStatus({ ai: 'gemini', demoLines: 1200 })).toEqual({ ready: true }));
  it('no model: says which settings to check, never the key', () => {
    const s = assistantStatus({ ai: null, demoLines: 1200 });
    expect(s.ready).toBe(false);
    if (!s.ready) expect(s.reason).toMatch(/AI_API_KEY.*AI_PROVIDER/);
  });
  it('no demo data: says how to seed it', () => {
    const s = assistantStatus({ ai: 'gemini', demoLines: 0 });
    if (s.ready) throw new Error();
    expect(s.reason).toMatch(/npm run db:seed/);
  });
});
