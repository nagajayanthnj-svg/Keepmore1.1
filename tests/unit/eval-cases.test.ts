import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sealCaseFile, type CaseFile } from '../../src/case/case-file';

interface EvalCase {
  id: string;
  split: 'dev' | 'heldout';
  asOf: string;
  caseFile: CaseFile;
}
interface Grid {
  [id: string]: {
    stage: string;
    delivery: string;
    buyerText: string;
    actions: string;
    amountBand: string;
    deadline: string;
  };
}

const dir = 'eval/cases';
const files = readdirSync(dir)
  .filter((f) => /^EV-\d{2}\.json$/.test(f))
  .sort();
const cases: EvalCase[] = files.map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const grid: Grid = JSON.parse(readFileSync('eval/grid.json', 'utf8'));

const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

describe('evaluation cases (T-309)', () => {
  it('are 36 files, EV-01 to EV-36, with 12 held out', () => {
    expect(files).toEqual(Array.from({ length: 36 }, (_, i) => `EV-${String(i + 1).padStart(2, '0')}.json`));
    expect(cases.filter((c) => c.split === 'heldout')).toHaveLength(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(36);
    expect(new Set(cases.map((c) => c.caseFile.disputeId)).size).toBe(36);
  });

  it('are sealed exactly like real case files: the hash matches the contents', () => {
    for (const c of cases) {
      const { hash, ...body } = c.caseFile;
      expect(sealCaseFile(body).hash, c.id).toBe(hash);
    }
  });

  it('carry no label: only the input fields, no expected action, recommendation or row tag', () => {
    const inputKeys = [
      'allowedActions',
      'buyerMessages',
      'caseId',
      'dispute',
      'disputeId',
      'evidence',
      'hash',
      'orderLinked',
      'policy',
      'version',
    ];
    for (const c of cases) {
      expect(Object.keys(c).sort(), c.id).toEqual(['asOf', 'caseFile', 'id', 'split']);
      expect(Object.keys(c.caseFile).sort(), c.id).toEqual(inputKeys);
    }
  });

  it('hold only invented data: no email, phone, street address, and every REC id has the right shape', () => {
    for (const c of cases) {
      const text = JSON.stringify(c.caseFile);
      expect(text, c.id).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      const content = text
        .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?/g, '')
        .replace(/"(?:hash|caseId)":"[^"]*"/g, '')
        .replace(/REC-[0-9A-F]{10}/g, '');
      expect(content, c.id).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
      expect(text, c.id).not.toMatch(/\b\d{1,5}\s+[A-Za-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln)\b/i);
      for (const e of c.caseFile.evidence) expect(e.id).toMatch(/^REC-[0-9A-F]{10}$/);
      for (const m of c.caseFile.buyerMessages) {
        expect(m.id).toMatch(/^REC-[0-9A-F]{10}$/);
        expect(m.quoted).toBe(true);
      }
      expect(c.caseFile.caseId.startsWith('EVAL-')).toBe(true);
      expect(c.caseFile.disputeId.startsWith('PP-EVAL-')).toBe(true);
    }
  });

  it('use only stages, statuses and actions seen in the sandbox or fixtures', () => {
    const stages = new Set(['INQUIRY', 'CHARGEBACK']);
    const actions = new Set([
      'ACCEPT_CLAIM',
      'PROVIDE_EVIDENCE',
      'PROVIDE_SUPPORTING_INFO',
      'SEND_MESSAGE',
      'ESCALATE',
    ]);
    for (const c of cases) {
      expect(stages.has(c.caseFile.dispute.stage), c.id).toBe(true);
      for (const a of c.caseFile.allowedActions.actions) expect(actions.has(a), c.id).toBe(true);
      // a PARTIAL_REFUND type only where accept-claim is allowed
      if (c.caseFile.allowedActions.acceptClaimTypes.length > 0)
        expect(c.caseFile.allowedActions.actions, c.id).toContain('ACCEPT_CLAIM');
    }
  });

  it('cover every value of every grid dimension at least twice', () => {
    const dims = ['stage', 'delivery', 'buyerText', 'actions', 'amountBand', 'deadline'] as const;
    expect(Object.keys(grid).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const d of dims) {
      const counts = count(Object.values(grid).map((g) => g[d]));
      for (const [value, n] of Object.entries(counts)) expect(n, `${d}=${value}`).toBeGreaterThanOrEqual(2);
    }
    expect(Object.keys(count(Object.values(grid).map((g) => g.delivery))).sort()).toEqual([
      'DELIVERED',
      'DELIVERED_TO_NEIGHBOUR',
      'HELD_OR_EXCEPTION',
      'IN_TRANSIT',
      'NO_SHIPMENT',
      'UNKNOWN',
    ]);
    expect(Object.keys(count(Object.values(grid).map((g) => g.buyerText))).sort()).toEqual([
      'CONTACT_DETAILS',
      'CONTRADICTS_RECORDS',
      'INJECTION',
      'NONE',
      'ORDINARY',
    ]);
  });

  it('keep the held-out cases spread across the grid (each stage and each buyer-text kind appears among them)', () => {
    const held = cases.filter((c) => c.split === 'heldout').map((c) => grid[c.id]!);
    expect(new Set(held.map((g) => g.stage))).toEqual(new Set(['INQUIRY', 'CHARGEBACK']));
    expect(new Set(held.map((g) => g.buyerText)).size).toBeGreaterThanOrEqual(4);
  });
});
