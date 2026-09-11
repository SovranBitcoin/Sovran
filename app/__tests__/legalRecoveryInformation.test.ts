import { readRecoveryInformation } from '@/features/settings/lib/readRecoveryInformation';
import { retrieveMnemonic, retrieveImportedNsec } from '@/shared/lib/nostr/secureStorage';
import {
  deriveNostrKeys,
  deriveCashuMnemonicForImported,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { getPublicKey } from 'nostr-tools/pure';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
  retrieveImportedNsec: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/keyDerivation', () => ({
  deriveNostrKeys: jest.fn(),
  deriveCashuMnemonic: () => 'derived-cashu',
  deriveCashuMnemonicForImported: jest.fn(() => 'imported-cashu'),
  pubkeyToAccountNumber: jest.fn(() => 17),
}));
jest.mock('nostr-tools/pure', () => ({ getPublicKey: jest.fn() }));
jest.mock('nostr-tools/nip19', () => ({
  decode: () => ({ type: 'nsec', data: new Uint8Array(32) }),
}));
const profile: ProfileEntry = {
  accountIndex: 17,
  pubkey: 'a'.repeat(64),
  addedAt: 0,
  source: 'imported',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(retrieveMnemonic).mockResolvedValue('test-root-placeholder');
  jest.mocked(retrieveImportedNsec).mockResolvedValue('test-imported-placeholder');
  jest.mocked(getPublicKey).mockReturnValue(profile.pubkey);
});
test('imported profiles use their own verified key and imported Cashu derivation without switching the active account', async () => {
  expect(await readRecoveryInformation(profile)).toMatchObject({
    nsec: 'test-imported-placeholder',
    cashuMnemonic: 'imported-cashu',
  });
  expect(retrieveImportedNsec).toHaveBeenCalledWith(profile.pubkey);
  expect(pubkeyToAccountNumber).toHaveBeenCalledWith(profile.pubkey);
  expect(deriveCashuMnemonicForImported).toHaveBeenCalledWith('test-root-placeholder', 17);
  expect(deriveNostrKeys).not.toHaveBeenCalled();
});
test('rejects an imported key for a different identity instead of displaying a misleading backup', async () => {
  jest.mocked(getPublicKey).mockReturnValue('b'.repeat(64));
  await expect(readRecoveryInformation(profile)).rejects.toThrow('does not match');
  expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
});
test('missing root does not hide an available imported identity or manufacture wallet recovery data', async () => {
  jest.mocked(retrieveMnemonic).mockResolvedValue(null);
  expect(await readRecoveryInformation(profile)).toMatchObject({
    mnemonic: null,
    cashuMnemonic: null,
    nsec: 'test-imported-placeholder',
  });
  await expect(readRecoveryInformation(null)).rejects.toThrow('unavailable');
  expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
});
