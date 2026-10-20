import { describe, expect, it } from 'vitest';
import { normaliseStatus } from '../../src/normalise/carrier-status';

const signed = (who: string) => `Delivered - Signed for by : ${who}`;

describe('DHL "Signed for by" is only DELIVERED for a real-looking signer name', () => {
  it.each(['A KUMAR', "S. O'Brien", 'Mary-Ann', 'José Álvarez', 'Notan Singh', 'R Holder'])(
    'accepts the name %s',
    (who) => {
      expect(normaliseStatus('DHL', signed(who))).toBe('DELIVERED');
    },
  );

  it.each([
    'no one',
    'nobody',
    'none',
    'unknown',
    'unable to deliver',
    'N A',
    'pending',
    'unclaimed',
    'awaiting collection',
    'held at depot',
    'on hold',
    'cancelled',
    'damaged',
    'missing',
    'RTO',
    'redirected',
    'customs',
    'delivery failed',
  ])('does not accept "%s" as a signer', (who) => {
    expect(normaliseStatus('DHL', signed(who))).toBe('UNKNOWN');
  });
});
