import { shouldShowMintOfflineWarning } from '@/features/send/lib/sendTokenWarning';

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
});
