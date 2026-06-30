/**
 * Pins the capability-bundle invariants: no bundle ever carries a critical
 * grant key (an Always-bundle must never auto-sign wallet/decrypt/deletion),
 * never-sign kinds (14/15/1059) stay out, keys are unique across bundles,
 * the reverse lookup is total over bundle keys, and the tri-state derivation.
 */

/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({ loggableIssues: () => [] }));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  }),
}));

import { isCriticalGrantKey } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { profileToMetadataPartial } from '@/shared/hooks/nostrPersonMapping';
import {
  bundleForGrantKey,
  bundleTriState,
  PERMISSION_BUNDLES,
} from '@/features/nostrSigner/lib/permissionBundles';

describe('PERMISSION_BUNDLES invariants', () => {
  it('no bundle contains a critical grant key', () => {
    for (const bundle of PERMISSION_BUNDLES) {
      for (const grantKey of bundle.grantKeys) {
        expect(isCriticalGrantKey(grantKey)).toBe(false);
      }
    }
  });

  it('never-sign kinds and locked concepts are unbundled', () => {
    for (const key of [
      'sign_event:14',
      'sign_event:15',
      'sign_event:1059',
      'sign_event:5',
      'sign_event:17375',
      'nip44_decrypt',
      'nip04_decrypt',
    ] as const) {
      expect(bundleForGrantKey(key)).toBeNull();
    }
  });

  it('no grant key appears in two bundles', () => {
    const seen = new Set<string>();
    for (const bundle of PERMISSION_BUNDLES) {
      for (const grantKey of bundle.grantKeys) {
        expect(seen.has(grantKey)).toBe(false);
        seen.add(grantKey);
      }
    }
  });

  it('reverse lookup resolves every bundle key to its bundle', () => {
    for (const bundle of PERMISSION_BUNDLES) {
      for (const grantKey of bundle.grantKeys) {
        expect(bundleForGrantKey(grantKey)?.id).toBe(bundle.id);
      }
    }
    expect(bundleForGrantKey('sign_event:1')?.id).toBe('postPublicly');
    expect(bundleForGrantKey('nip44_encrypt')?.id).toBe('privateMessages');
    expect(bundleForGrantKey('sign_event:31337')).toBeNull();
  });
});

describe('bundleTriState', () => {
  const bundle = PERMISSION_BUNDLES.find((b) => b.id === 'privateMessages')!;

  it('uniform verdicts map directly', () => {
    expect(bundleTriState(() => 'always', bundle)).toBe('allow');
    expect(bundleTriState(() => 'deny', bundle)).toBe('block');
    expect(bundleTriState(() => undefined, bundle)).toBe('ask');
  });

  it('any disagreement is mixed', () => {
    expect(bundleTriState((key) => (key === 'nip44_encrypt' ? 'always' : undefined), bundle)).toBe(
      'mixed'
    );
    expect(bundleTriState((key) => (key === 'sign_event:4' ? 'deny' : 'always'), bundle)).toBe(
      'mixed'
    );
  });
});

describe('profileToMetadataPartial', () => {
  it('maps nagg profile fields and prefers picture over image', () => {
    expect(
      profileToMetadataPartial({
        displayName: 'Alice',
        name: 'alice',
        picture: 'https://a/p.png',
        image: 'https://a/i.png',
        nip05: 'alice@a.com',
      })
    ).toEqual({
      displayName: 'Alice',
      name: 'alice',
      picture: 'https://a/p.png',
      nip05: 'alice@a.com',
    });
  });

  it('falls back to image and omits absent fields', () => {
    expect(profileToMetadataPartial({ image: 'https://a/i.png' })).toEqual({
      picture: 'https://a/i.png',
    });
  });
});

describe('bundle copy', () => {
  it('zaps bundle reads "Zap posts"', () => {
    const zaps = PERMISSION_BUNDLES.find((b) => b.id === 'zaps');
    expect(zaps?.label).toBe('Zap posts');
    expect(zaps?.alwaysVerbPhrase).toBe('zap posts');
  });
});
