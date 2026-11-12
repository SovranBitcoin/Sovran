/**
 * @jest-environment node
 *
 * Characterization of `resolveIdentityName`: which of the caller's name sources
 * wins, in order, and what is shown when none is usable.
 */

import { resolveIdentityName } from '@/shared/lib/identity';
import { getUsername } from '@/shared/lib/username';

const PUBKEY = 'ab'.repeat(32);

/** Every source filled, so each test removes the ones above the step it pins. */
const ALL = {
  overrideName: 'Pinned nickname',
  mintName: 'Mint Name',
  nostrProfile: { display_name: 'Display_name', displayName: 'DisplayName', name: 'name' },
  bleNickname: 'ble-nick',
  pubkey: PUBKEY,
  fallbackName: 'routstr',
};

describe('resolveIdentityName', () => {
  it('walks the sources in order: override, mint, display name, name, BLE, pubkey words, fallback', () => {
    expect(resolveIdentityName(ALL)).toBe('Pinned nickname');
    expect(resolveIdentityName({ ...ALL, overrideName: null })).toBe('Mint Name');
    expect(resolveIdentityName({ ...ALL, overrideName: null, mintName: null })).toBe(
      'Display_name'
    );
    expect(
      resolveIdentityName({
        ...ALL,
        overrideName: null,
        mintName: null,
        nostrProfile: { name: 'name' },
      })
    ).toBe('name');
    expect(
      resolveIdentityName({ ...ALL, overrideName: null, mintName: null, nostrProfile: null })
    ).toBe('ble-nick');
    expect(
      resolveIdentityName({
        pubkey: PUBKEY,
        fallbackName: 'routstr',
      })
    ).toBe(getUsername(PUBKEY));
    expect(resolveIdentityName({ fallbackName: 'routstr' })).toBe('routstr');
  });

  it("returns 'Unknown' when nothing usable is given", () => {
    expect(resolveIdentityName({})).toBe('Unknown');
    expect(
      resolveIdentityName({ overrideName: ' ', mintName: '', bleNickname: '\t', fallbackName: ' ' })
    ).toBe('Unknown');
  });

  it('prefers display_name over displayName when a profile carries both', () => {
    // QUIRK: the snake_case NIP-01 field beats the camelCase one, though the doc comment names
    // `displayName` first. A change of precedence should change this assertion on purpose.
    expect(
      resolveIdentityName({ nostrProfile: { display_name: 'snake', displayName: 'camel' } })
    ).toBe('snake');
    expect(resolveIdentityName({ nostrProfile: { displayName: 'camel' } })).toBe('camel');
  });

  it('trims the winning name and skips whitespace-only sources', () => {
    expect(resolveIdentityName({ overrideName: '   ', mintName: '  Trimmed Mint  ' })).toBe(
      'Trimmed Mint'
    );
    expect(
      resolveIdentityName({ nostrProfile: { display_name: '  ', displayName: ' ', name: ' n ' } })
    ).toBe('n');
  });

  it('gives the pubkey word pair priority over the semantic fallback', () => {
    expect(resolveIdentityName({ pubkey: PUBKEY, fallbackName: 'routstr' })).not.toBe('routstr');
    expect(resolveIdentityName({ pubkey: PUBKEY })).toBe(resolveIdentityName({ pubkey: PUBKEY }));
  });

  it('never uses a NIP-05 address as a name', () => {
    const profile = { nip05: 'alice@example.com' } as unknown as { name?: string };

    expect(resolveIdentityName({ nostrProfile: profile })).toBe('Unknown');
  });

  it('lets a mint name beat the Nostr display name', () => {
    expect(
      resolveIdentityName({ mintName: 'Mint', nostrProfile: { displayName: 'Operator' } })
    ).toBe('Mint');
  });
});
