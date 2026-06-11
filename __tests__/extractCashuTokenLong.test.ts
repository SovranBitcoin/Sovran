import { getEncodedToken } from '@cashu/cashu-ts';

import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';

const KEYSET_ID = '009a1f293253e41e';
const MINT_URL = 'https://mint.test';

function p2pkProof(amount: number, index: number) {
  return {
    amount,
    id: KEYSET_ID,
    secret: JSON.stringify([
      'P2PK',
      { nonce: index.toString(16).padStart(32, '0'), data: `02${'ab'.repeat(32)}` },
    ]),
    C: `02${'ef'.repeat(32)}`,
  };
}

describe('extractCashuToken with P2PK-locked tokens', () => {
  it('extracts a many-proof locked token larger than the old 5000-char cap', () => {
    // ~25 P2PK proofs × ~150-byte JSON secrets pushes the encoded token well
    // past 5000 chars — the pre-P2PK cap that used to truncate extraction.
    const proofs = Array.from({ length: 25 }, (_, i) => p2pkProof(2 ** (i % 8), i));
    const token = getEncodedToken({ mint: MINT_URL, proofs, unit: 'sat' });
    expect(token.length).toBeGreaterThan(5000);

    expect(extractCashuToken(token)).toBe(token);
  });

  it('extracts a token embedded in surrounding text', () => {
    const token = getEncodedToken({
      mint: MINT_URL,
      proofs: [p2pkProof(4, 1)],
      unit: 'sat',
    });
    expect(extractCashuToken(`here you go ${token} enjoy`)).toBe(token);
  });

  it('returns null for non-token content', () => {
    expect(extractCashuToken('no tokens here')).toBeNull();
    expect(extractCashuToken('cashuB!!!notvalid')).toBeNull();
  });
});
