/**
 * Pins the "common social actions" pairing preset: the bundle can NEVER
 * contain decrypt methods, NIP-60/61 wallet kinds, kind-5 deletions, or DM
 * kinds; every key is a valid, always-grantable grant key; and the
 * URI-dedupe helper excludes covered keys.
 */

import { isCriticalGrantKey } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  PAIRING_PRESET_GRANT_KEYS,
  presetGrantKeysExcluding,
} from '@/features/nostrSigner/lib/pairingPreset';
import { isGrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { classifyRequest, parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';

describe('PAIRING_PRESET_GRANT_KEYS', () => {
  it('contains only valid grant keys', () => {
    for (const key of PAIRING_PRESET_GRANT_KEYS) {
      expect(isGrantKey(key)).toBe(true);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(PAIRING_PRESET_GRANT_KEYS).size).toBe(PAIRING_PRESET_GRANT_KEYS.length);
  });

  it('NEVER contains decrypt methods', () => {
    expect(PAIRING_PRESET_GRANT_KEYS).not.toContain('nip04_decrypt');
    expect(PAIRING_PRESET_GRANT_KEYS).not.toContain('nip44_decrypt');
  });

  it('NEVER contains wallet kinds, deletions, or DM kinds', () => {
    for (const kind of [17375, 7375, 7374, 7376, 9321, 10019, 5, 4, 13, 14, 1059]) {
      expect(PAIRING_PRESET_GRANT_KEYS).not.toContain(`sign_event:${kind}`);
    }
  });

  it('every key is non-critical (the store would accept an always-grant)', () => {
    for (const key of PAIRING_PRESET_GRANT_KEYS) {
      expect(isCriticalGrantKey(key)).toBe(false);
    }
  });

  it('every key classifies below critical at request time too', () => {
    for (const key of PAIRING_PRESET_GRANT_KEYS) {
      const { class: sensitivity } = classifyRequest(parseGrantKey(key));
      expect(['normal', 'sensitive']).toContain(sensitivity);
    }
  });

  it('covers the prompt-storm kinds Primal actually signs', () => {
    for (const kind of [1, 3, 6, 7, 30078, 22242, 27235]) {
      expect(PAIRING_PRESET_GRANT_KEYS).toContain(`sign_event:${kind}`);
    }
  });
});

describe('presetGrantKeysExcluding', () => {
  it('excludes keys the URI already covers', () => {
    const remaining = presetGrantKeysExcluding(new Set(['sign_event:1', 'nip44_encrypt']));
    expect(remaining).not.toContain('sign_event:1');
    expect(remaining).not.toContain('nip44_encrypt');
    expect(remaining).toContain('sign_event:7');
    expect(remaining).toHaveLength(PAIRING_PRESET_GRANT_KEYS.length - 2);
  });

  it('returns the full bundle for an empty cover set (the Primal case)', () => {
    expect(presetGrantKeysExcluding(new Set())).toEqual([...PAIRING_PRESET_GRANT_KEYS]);
  });
});
