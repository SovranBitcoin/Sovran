import { readRecoveryInformation } from '@/features/settings/lib/readRecoveryInformation';
import { retrieveMnemonic, retrieveImportedNsec } from '@/shared/lib/nostr/secureStorage';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
  retrieveImportedNsec: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { info: jest.fn(), debug: jest.fn() } }));
// Public vectors shared with keyDerivation.test.ts.
const ROOT_MNEMONIC =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';
const IMPORTED_NSEC = 'nsec1jlpx0y7gffw63zrhv8fu2lawrcxl7evtz6w5v67urh59j4l0fsys7hr66h';
const OTHER_NSEC = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';
const profile: ProfileEntry = {
  accountIndex: 17,
  pubkey: '9969973b30f3e1912ea1607d3f7beab11c7cd723ae932d451bdbbd9ce9dc2bfc',
  addedAt: 0,
  source: 'imported',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(retrieveMnemonic).mockResolvedValue(ROOT_MNEMONIC);
  jest.mocked(retrieveImportedNsec).mockResolvedValue(IMPORTED_NSEC);
});
test('imported profiles use their own verified key and imported Cashu derivation without switching the active account', async () => {
  expect(await readRecoveryInformation(profile)).toEqual({
    mnemonic: ROOT_MNEMONIC,
    nsec: IMPORTED_NSEC,
    cashuMnemonic:
      'amazing small ankle organ august aisle assist bicycle win address cloth orient melt toilet obtain certain add orphan cube six bomb section spring lab',
  });
  expect(retrieveImportedNsec).toHaveBeenCalledWith(profile.pubkey);
});
test('rejects an imported key for a different identity instead of displaying a misleading backup', async () => {
  jest.mocked(retrieveImportedNsec).mockResolvedValue(OTHER_NSEC);
  await expect(readRecoveryInformation(profile)).rejects.toThrow('does not match');
});
test('missing root does not hide an available imported identity or manufacture wallet recovery data', async () => {
  jest.mocked(retrieveMnemonic).mockResolvedValue(null);
  expect(await readRecoveryInformation(profile)).toEqual({
    mnemonic: null,
    cashuMnemonic: null,
    nsec: IMPORTED_NSEC,
  });
  await expect(readRecoveryInformation(null)).rejects.toThrow('unavailable');
});
