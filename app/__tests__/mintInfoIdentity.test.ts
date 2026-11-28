import { resolveMintInfoIdentity } from '@/features/mint/lib/mintInfoIdentity';

const URL = 'https://mint.example';

describe('resolveMintInfoIdentity', () => {
  it('paints a stored name and icon before the bridge fetch lands', () => {
    expect(
      resolveMintInfoIdentity({ mintUrl: URL }, { displayName: 'Example', iconUrl: 'i.png' }, URL)
    ).toEqual({ displayName: 'Example', iconUrl: 'i.png' });
  });

  it('prefers the fetched value, then the caller seed, over the store', () => {
    const cached = { displayName: 'Stored', iconUrl: 'stored.png' };
    expect(
      resolveMintInfoIdentity({ displayName: 'Fetched', iconUrl: 'f.png' }, cached, URL)
    ).toEqual({ displayName: 'Fetched', iconUrl: 'f.png' });
    expect(
      resolveMintInfoIdentity({ seedDisplayName: 'Seed', seedIconUrl: 's.png' }, cached, URL)
    ).toEqual({ displayName: 'Seed', iconUrl: 's.png' });
  });

  it('falls back to the URL only when nothing knows the name', () => {
    expect(resolveMintInfoIdentity({ seedDisplayName: '' }, undefined, URL)).toEqual({
      displayName: URL,
      iconUrl: undefined,
    });
  });
});
