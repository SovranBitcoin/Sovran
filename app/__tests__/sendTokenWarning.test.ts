import { getSendTokenReachabilityWarning, shouldShowMintOfflineWarning } from 'wallet';

describe('send token mint offline warning', () => {
  it('shows while a mint-unreachable offline token is still pending', () => {
    expect(shouldShowMintOfflineWarning({ state: 'pending' }, true)).toBe(true);
  });

  it('hides when the token was created while the wallet was generally offline', () => {
    expect(shouldShowMintOfflineWarning({ state: 'pending' }, false)).toBe(false);
  });

  it('hides after the token is finalized or rolled back', () => {
    expect(shouldShowMintOfflineWarning({ state: 'finalized' }, true)).toBe(false);
    expect(shouldShowMintOfflineWarning({ state: 'rolledBack' }, true)).toBe(false);
  });

  it('uses device-offline copy for local-first sends while the device is offline', () => {
    expect(
      getSendTokenReachabilityWarning(
        { state: 'pending' },
        { reachabilityStatus: 'device-offline' }
      )
    ).toMatchObject({ title: 'You were offline' });
  });

  it('uses mint-unreachable copy when the background mint probe fails', () => {
    expect(
      getSendTokenReachabilityWarning(
        { state: 'pending' },
        { reachabilityStatus: 'mint-unreachable' }
      )
    ).toMatchObject({ title: 'Mint appears offline' });
  });

  it('shows no local-first warning when the mint probe succeeds', () => {
    expect(
      getSendTokenReachabilityWarning(
        { state: 'pending' },
        { reachabilityStatus: 'mint-reachable' }
      )
    ).toBeNull();
  });
});
