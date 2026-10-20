import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedActions, hasAction, type ActionCode } from '../../src/disputes/allowed-actions';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const codes = (details: unknown): ActionCode[] => allowedActions(details).actions.map((a) => a.action);

describe('allowedActions: the expected set for each real state', () => {
  it('inquiry, waiting for the buyer, with evidence requested', () => {
    expect(codes(fx('t010-PP-R-RAV-10193566-evidence-1-before'))).toEqual([
      'ACCEPT_CLAIM',
      'PROVIDE_EVIDENCE',
      'SEND_MESSAGE',
      'ESCALATE',
    ]);
  });

  it('inquiry after the evidence was provided: no provide_evidence link, so no PROVIDE_EVIDENCE', () => {
    expect(codes(fx('t010-PP-R-RAV-10193566-escalate-1-before'))).toEqual(['ACCEPT_CLAIM', 'SEND_MESSAGE', 'ESCALATE']);
  });

  it('chargeback waiting for the seller', () => {
    expect(codes(fx('dispute-details'))).toEqual(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE']);
    expect(codes(fx('dispute-details-first'))).toEqual(['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE']);
  });

  it('chargeback under PayPal review: supporting info, and never the sandbox-only require_evidence or adjudicate', () => {
    const d = fx('dispute-after-supporting-info');
    expect(d.links.map((l: { rel: string }) => l.rel)).toEqual(
      expect.arrayContaining(['require_evidence', 'adjudicate']),
    );
    expect(codes(d)).toEqual(['ACCEPT_CLAIM', 'PROVIDE_SUPPORTING_INFO']);
  });

  it('chargeback under review with only the supporting-info link', () => {
    expect(codes(fx('dispute-after-require-evidence'))).toEqual(['PROVIDE_SUPPORTING_INFO']);
  });

  it.each([
    ['t009-PP-R-IUT-10193562-accept-3-final'],
    ['t010-PP-R-RAV-10193566-escalate-3-final'],
    ['t009-PP-R-RAV-10193566-adjudicate-3-final'],
  ])('resolved or sent for review (%s): nothing is allowed', (name) => {
    expect(allowedActions(fx(name))).toEqual({ actions: [], acceptClaimTypes: [] });
  });
});

describe('allowedActions: the accept-claim types PayPal offers', () => {
  it('reads them from allowed_response_options', () => {
    expect(allowedActions(fx('dispute-details')).acceptClaimTypes).toEqual(['REFUND', 'PARTIAL_REFUND']);
    expect(allowedActions(fx('dispute-details-first')).acceptClaimTypes).toEqual(['REFUND']);
  });

  it('is empty when accept_claim is not allowed, even if options are listed', () => {
    const d = structuredClone(fx('dispute-details'));
    d.links = d.links.filter((l: { rel: string }) => l.rel !== 'accept_claim');
    expect(allowedActions(d).acceptClaimTypes).toEqual([]);
  });

  it('is empty, not guessed, when accept_claim is allowed but PayPal lists no types', () => {
    const d = structuredClone(fx('dispute-details'));
    delete d.allowed_response_options;
    expect(codes(d)).toContain('ACCEPT_CLAIM');
    expect(allowedActions(d).acceptClaimTypes).toEqual([]);
  });

  it('keeps only plain codes', () => {
    const d = structuredClone(fx('dispute-details'));
    d.allowed_response_options.accept_claim.accept_claim_types = ['REFUND', '<b>', 7, 'REFUND'];
    expect(allowedActions(d).acceptClaimTypes).toEqual(['REFUND']);
  });
});

describe('allowedActions: links are looked up by rel, never by position', () => {
  it('gives the same answer for two real responses of one state with the links in a different order', () => {
    const a = fx('dispute-before-supporting-info');
    const b = fx('dispute-after-supporting-info');
    expect(a.links.map((l: { rel: string }) => l.rel)).not.toEqual(b.links.map((l: { rel: string }) => l.rel));
    expect(allowedActions(a)).toEqual(allowedActions(b));
  });

  it('is the same for every ordering of the links', () => {
    const d = fx('t010-PP-R-RAV-10193566-evidence-1-before');
    const want = allowedActions(d);
    for (const links of [[...d.links].reverse(), [...d.links.slice(2), ...d.links.slice(0, 2)]]) {
      expect(allowedActions({ ...d, links })).toEqual(want);
    }
  });

  it('returns actions in one fixed order, whatever order PayPal used', () => {
    const d = fx('t010-PP-R-RAV-10193566-evidence-1-before');
    expect(codes({ ...d, links: [...d.links].reverse() })).toEqual([
      'ACCEPT_CLAIM',
      'PROVIDE_EVIDENCE',
      'SEND_MESSAGE',
      'ESCALATE',
    ]);
  });

  it('returns the path of the link, on this dispute, and never the host', () => {
    const a = allowedActions(fx('dispute-details')).actions[0]!;
    expect(a).toEqual({
      action: 'ACCEPT_CLAIM',
      rel: 'accept_claim',
      method: 'POST',
      path: '/v1/customer/disputes/PP-R-RAV-10193566/accept-claim',
    });
  });
});

describe('allowedActions: a link we cannot trust does not allow anything', () => {
  const withLinks = (links: unknown) => ({ ...structuredClone(fx('dispute-details')), links });
  const link = (rel: string, href: string, method = 'POST') => ({ rel, href, method });
  const base = 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-RAV-10193566';

  it('ignores a rel it does not know', () => {
    expect(
      codes(withLinks([link('adjudicate', `${base}/adjudicate`), link('delete_everything', `${base}/delete`)])),
    ).toEqual([]);
  });

  it('refuses a link with the wrong method', () => {
    expect(codes(withLinks([link('accept_claim', `${base}/accept-claim`, 'GET')]))).toEqual([]);
    expect(codes(withLinks([{ rel: 'accept_claim', href: `${base}/accept-claim` }]))).toEqual([]);
  });

  it('refuses a link that points at another dispute', () => {
    expect(
      codes(
        withLinks([
          link('accept_claim', 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-OTHER-1/accept-claim'),
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a link whose path is not the action it says it is', () => {
    expect(codes(withLinks([link('accept_claim', `${base}/escalate`)]))).toEqual([]);
    expect(codes(withLinks([link('accept_claim', `${base}/accept-claim/extra`)]))).toEqual([]);
    expect(
      codes(withLinks([link('accept_claim', 'https://api-m.sandbox.paypal.com/v2/payments/captures/X/refund')])),
    ).toEqual([]);
  });

  it('refuses a link that is not an https URL', () => {
    expect(
      codes(
        withLinks([
          link('accept_claim', `http://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-RAV-10193566/accept-claim`),
        ]),
      ),
    ).toEqual([]);
    expect(codes(withLinks([link('accept_claim', 'not a url')]))).toEqual([]);
    expect(codes(withLinks([link('accept_claim', '/v1/customer/disputes/PP-R-RAV-10193566/accept-claim')]))).toEqual(
      [],
    );
  });

  it('allows an action repeated with the same link, and refuses one repeated with different links', () => {
    const l = link('accept_claim', `${base}/accept-claim`);
    expect(codes(withLinks([l, { ...l }]))).toEqual(['ACCEPT_CLAIM']);
    expect(codes(withLinks([l, link('accept_claim', `${base}/accept-claim?x=1`)]))).toEqual([]);
  });

  it.each([[undefined], [null], ['links'], [{}], [[null, 1, 'x', []]]])('gives nothing for links = %j', (links) => {
    expect(allowedActions(withLinks(links))).toEqual({ actions: [], acceptClaimTypes: [] });
  });

  it.each([[null], [undefined], ['x'], [[]], [{}], [{ dispute_id: 'not an id', links: [] }]])(
    'gives nothing for the payload %j',
    (payload) => {
      expect(allowedActions(payload)).toEqual({ actions: [], acceptClaimTypes: [] });
    },
  );
});

describe('hasAction', () => {
  it('is the one check the UI and the server both use', () => {
    const a = allowedActions(fx('dispute-details'));
    expect(hasAction(a, 'ACCEPT_CLAIM')).toBe(true);
    expect(hasAction(a, 'ESCALATE')).toBe(false);
  });
});
