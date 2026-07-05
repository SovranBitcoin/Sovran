/** @jest-environment node */

import {
  deriveCreqMintSelection,
  REASON_LAST_MINT,
  REASON_NO_P2PK,
  REASON_OVER_CAP,
  type CreqMintCandidate,
} from '@/features/receive/lib/creqMintSelection';

const NUT11 = { '11': { supported: true } };
const NO_NUT11 = { '7': { supported: true } };

function mint(url: string, nuts: Record<string, unknown>, name?: string): CreqMintCandidate {
  return { mintUrl: url, mintInfo: { name, nuts } };
}

const A = mint('https://a.mint.example', NUT11, 'Mint A');
const B = mint('https://b.mint.example', NO_NUT11, 'Mint B');
const C = mint('https://c.mint.example', NUT11);

const base = { excluded: {}, p2pkLockActive: false, maxAdvertised: 5 };

describe('deriveCreqMintSelection', () => {
  it('advertises every trusted mint by default', () => {
    const s = deriveCreqMintSelection({ ...base, mints: [A, B, C] });
    expect(s.displayMints).toEqual([A.mintUrl, B.mintUrl, C.mintUrl]);
    expect(s.options.map((o) => o.enabled)).toEqual([true, true, true]);
    expect(s.options.every((o) => o.reason === null)).toBe(true);
    expect(s.advertisedCount).toBe(3);
    expect(s.totalCount).toBe(3);
    expect(s.hasP2pkCapableMint).toBe(true);
    expect(s.needsExclusionReset).toBe(false);
  });

  it('uses the mint-info name and falls back to the domain', () => {
    const s = deriveCreqMintSelection({ ...base, mints: [A, C] });
    expect(s.options[0].displayName).toBe('Mint A');
    expect(s.options[1].displayName).toBe('c.mint.example');
  });

  it('drops excluded mints from the advertisement', () => {
    const s = deriveCreqMintSelection({
      ...base,
      mints: [A, B, C],
      excluded: { [B.mintUrl]: true },
    });
    expect(s.displayMints).toEqual([A.mintUrl, C.mintUrl]);
    expect(s.options[1].enabled).toBe(false);
  });

  it('locks the switch on the last advertised mint', () => {
    const s = deriveCreqMintSelection({
      ...base,
      mints: [A, B],
      excluded: { [B.mintUrl]: true },
    });
    expect(s.options[0].switchDisabled).toBe(true);
    expect(s.options[0].reason).toBe(REASON_LAST_MINT);
    // The excluded row stays toggleable.
    expect(s.options[1].switchDisabled).toBe(false);
  });

  it('caps the advertised list and marks over-cap rows', () => {
    const s = deriveCreqMintSelection({ ...base, mints: [A, B, C], maxAdvertised: 2 });
    expect(s.displayMints).toEqual([A.mintUrl, B.mintUrl]);
    expect(s.advertisedCount).toBe(2);
    expect(s.options[2].enabled).toBe(true);
    expect(s.options[2].reason).toBe(REASON_OVER_CAP);
  });

  describe('P2PK lock active', () => {
    it('forces off mints without NUT-11 support, with a reason', () => {
      const s = deriveCreqMintSelection({ ...base, mints: [A, B, C], p2pkLockActive: true });
      expect(s.p2pkLockEffective).toBe(true);
      expect(s.displayMints).toEqual([A.mintUrl, C.mintUrl]);
      expect(s.options[1]).toMatchObject({
        enabled: false,
        switchDisabled: true,
        reason: REASON_NO_P2PK,
      });
    });

    it('is ineffective when no trusted mint supports NUT-11', () => {
      const s = deriveCreqMintSelection({ ...base, mints: [B], p2pkLockActive: true });
      expect(s.hasP2pkCapableMint).toBe(false);
      expect(s.p2pkLockEffective).toBe(false);
      // Behaves like lock-off: the mint is still advertised, no forced reason.
      expect(s.displayMints).toEqual([B.mintUrl]);
      expect(s.options[0].reason).toBe(REASON_LAST_MINT);
    });

    it('recovers when stale exclusions empty the capable set', () => {
      const s = deriveCreqMintSelection({
        ...base,
        mints: [A, B, C],
        p2pkLockActive: true,
        excluded: { [A.mintUrl]: true, [C.mintUrl]: true },
      });
      expect(s.needsExclusionReset).toBe(true);
      // Never an empty list under the lock — advertise the capable set.
      expect(s.displayMints).toEqual([A.mintUrl, C.mintUrl]);
      expect(s.options[0].enabled).toBe(true);
      expect(s.options[2].enabled).toBe(true);
    });
  });
});
