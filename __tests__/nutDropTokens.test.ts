import { getEncodedToken } from '@cashu/cashu-ts';

import { classifyToken, tokenDedupeKey } from '@/features/nearPay/lib/nutDropTokens';

const MY_PUBKEY = `02${'ab'.repeat(32)}`;
const OTHER_PUBKEY = `02${'cd'.repeat(32)}`;
const MINT_URL = 'https://mint.test';
const KEYSET_ID = '009a1f293253e41e';

function p2pkSecret(pubkey: string, tags?: string[][]): string {
  return JSON.stringify([
    'P2PK',
    { nonce: '11'.repeat(16), data: pubkey, ...(tags ? { tags } : {}) },
  ]);
}

function proof(secret: string, amount = 2) {
  return {
    amount,
    id: KEYSET_ID,
    secret,
    C: `02${'ef'.repeat(32)}`,
  };
}

function encode(proofs: ReturnType<typeof proof>[]): string {
  return getEncodedToken({ mint: MINT_URL, proofs, unit: 'sat' });
}

describe('classifyToken', () => {
  it('classifies a token fully locked to my key', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY), 2), proof(p2pkSecret(MY_PUBKEY), 4)]);
    expect(classifyToken(token, MY_PUBKEY)).toEqual({
      classification: 'locked-to-me',
      mintUrl: MINT_URL,
      amount: 6,
      unit: 'sat',
    });
  });

  it('matches the lock key case-insensitively', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY))]);
    expect(classifyToken(token, MY_PUBKEY.toUpperCase()).classification).toBe('locked-to-me');
  });

  it('classifies a token locked to another key', () => {
    const token = encode([proof(p2pkSecret(OTHER_PUBKEY))]);
    expect(classifyToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats mixed locked + bearer proofs as locked-to-other', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY)), proof('aa'.repeat(32))]);
    expect(classifyToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats multisig locks as locked-to-other even when my key is included', () => {
    const token = encode([
      proof(
        p2pkSecret(MY_PUBKEY, [
          ['pubkeys', OTHER_PUBKEY],
          ['n_sigs', '2'],
        ])
      ),
    ]);
    expect(classifyToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('classifies plain-secret tokens as bearer', () => {
    const token = encode([proof('aa'.repeat(32)), proof('bb'.repeat(32))]);
    expect(classifyToken(token, MY_PUBKEY).classification).toBe('bearer');
  });

  it('classifies undecodable strings as invalid', () => {
    expect(classifyToken('cashuBnotatoken', MY_PUBKEY).classification).toBe('invalid');
    expect(classifyToken('', MY_PUBKEY).classification).toBe('invalid');
  });
});

describe('tokenDedupeKey', () => {
  it('is stable for the same token and distinct for different tokens', () => {
    const a = encode([proof(p2pkSecret(MY_PUBKEY))]);
    const b = encode([proof(p2pkSecret(OTHER_PUBKEY))]);
    expect(tokenDedupeKey(a)).toBe(tokenDedupeKey(a));
    expect(tokenDedupeKey(a)).not.toBe(tokenDedupeKey(b));
    expect(tokenDedupeKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
