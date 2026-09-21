import { CocoCoreLogger } from '@/shared/lib/cashu/cocoLogger';
import { redactStorageDump } from '@/shared/lib/debug/storageInventory';
import { cashuLog, redactKnownSecretSubstrings, secretStringKind } from '@/shared/lib/logger';

// The logger, the coco logger and the storage dump used to carry their own
// copies of these patterns, and the lightning one had drifted: the logger
// copies missed short and regtest/simnet invoices, the storage copy missed
// signet (`lntbs`) and digit-less bodies. The single owner must catch the union.
const NSEC = `nsec1${'q'.repeat(58)}`;
const CASHU_TOKEN = `cashuB${'x'.repeat(30)}`;
const LIGHTNING_INVOICES = {
  // Caught by the old logger / coco copies (long opaque body).
  mainnetLong: `lnbc${'a'.repeat(50)}`,
  testnetLong: `LNTB${'A'.repeat(50)}`,
  signetLong: `lntbs${'a'.repeat(50)}`,
  // Caught only by the old storage-dump copy (amount digits + short body).
  mainnetShort: 'lnbc100n1pj9abcdefgh1234567890qwerty',
  regtestShort: 'lnbcrt500n1pj9abcdefghdevtestnetdevtest',
  simnetShort: 'lnsb1000n1pj9abcdefgh1234567890simnet',
  // Caught by neither copy before the merge.
  signetShort: 'lntbs250n1pj9abcdefgh1234567890signet',
};

const EMBEDDED_CASES: [name: string, secret: string, marker: string][] = [
  ['nsec', NSEC, '<REDACTED:nsec>'],
  ['cashu token', CASHU_TOKEN, '<REDACTED:cashu-token>'],
  ...Object.entries(LIGHTNING_INVOICES).map(([name, invoice]): [string, string, string] => [
    `lightning ${name}`,
    invoice,
    '<REDACTED:lightning-invoice>',
  ]),
];

describe('secret patterns — one owner, union of the old copies', () => {
  it.each(EMBEDDED_CASES)('logger redacts an embedded %s', (_name, secret, marker) => {
    expect(redactKnownSecretSubstrings(`failed for ${secret} at mint`)).toBe(
      `failed for ${marker} at mint`
    );
  });

  it.each(EMBEDDED_CASES)('storage dump redacts an embedded %s', (_name, secret, marker) => {
    const out = redactStorageDump({ store: { note: `failed for ${secret} at mint` } });
    expect((out.store as { note: string }).note).toBe(`failed for ${marker} at mint`);
  });

  it.each(EMBEDDED_CASES)('coco logger redacts an embedded %s', (_name, secret, marker) => {
    const info = jest.spyOn(cashuLog, 'info').mockImplementation(() => {});
    jest.spyOn(cashuLog, 'isLevelEnabled').mockReturnValue(true);
    new CocoCoreLogger('test').info('Request failed', { note: `failed for ${secret} at mint` });
    expect(info).toHaveBeenCalledWith('coco.test.request_failed', {
      note: `failed for ${marker} at mint`,
    });
    jest.restoreAllMocks();
  });

  it('classifies whole-string secrets the coco logger used to classify itself', () => {
    expect(secretStringKind(NSEC)).toBe('nsec');
    expect(secretStringKind(CASHU_TOKEN)).toBe('cashu_token');
    expect(secretStringKind('a'.repeat(64))).toBe('hex32');
    for (const invoice of Object.values(LIGHTNING_INVOICES)) {
      expect(secretStringKind(invoice)).toBe('lightning_invoice');
    }
    expect(secretStringKind('Fetching mint info')).toBeNull();
  });
});
