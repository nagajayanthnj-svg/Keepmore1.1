import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FixtureProvider } from '../../src/ai/fixture-provider';
import { providerFromEnv } from '../../src/ai/provider';
import { buildPrompt } from '../../src/ai/prompt';
import { AnalysisSchema } from '../../src/ai/schema';
import { validateClaims } from '../../src/ai/validate-claims';
import type { CaseFile } from '../../src/case/case-file';

const load = (id: string) => JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')) as { asOf: string; caseFile: CaseFile };

describe('test-only AI fixture (decision 7)', () => {
  it('is used only with AI_PROVIDER=fixture and KEEPMORE_E2E=1, and never in production', () => {
    expect(providerFromEnv({ AI_PROVIDER: 'fixture', KEEPMORE_E2E: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv)?.name).toBe('fixture');
    expect(providerFromEnv({ AI_PROVIDER: 'fixture', NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: 'fixture', KEEPMORE_E2E: '1', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('answers in the schema with one supported claim and one unverified claim that its draft rests on', async () => {
    const { caseFile, asOf } = load('EV-01');
    const out = AnalysisSchema.parse(JSON.parse(await new FixtureProvider().generate(buildPrompt(caseFile, new Date(asOf), true))));
    const v = validateClaims(out, caseFile);
    expect(v.results.map((r) => r.result).sort()).toEqual(['SUPPORTED', 'UNVERIFIED']);
    expect(v.draftBlocked).toBe(true);
    expect(out.recommendedAction).toBe('SEND_MESSAGE');
  });
  it('recommends evidence on a chargeback that offers it', async () => {
    const { caseFile, asOf } = load('EV-09');
    const out = JSON.parse(await new FixtureProvider().generate(buildPrompt(caseFile, new Date(asOf), true)));
    expect(out.recommendedAction).toBe('PROVIDE_EVIDENCE');
  });
});
