/**
 * @jest-environment node
 *
 * The Import account form the drawer opens: it hands on only a checked nsec,
 * with the public key and account number derived from it.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

import { openProfileImportMenu } from '@/shared/lib/popup/popups/actionSheets';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';

const mockHasPubkey = jest.fn((_pubkey: string) => false);
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ hasPubkey: (p: string) => mockHasPubkey(p) }) },
}));

type SubmitHelpers = { setError: jest.Mock; close: jest.Mock };
type MenuPayload = {
  title: string;
  primaryAction: {
    testID: string;
    onPress: (values: { nsec: string }, helpers: SubmitHelpers) => void;
  };
};
const mockActionMenuPopup = jest.fn();
jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: (...args: unknown[]) => mockActionMenuPopup(...args),
}));

function submit(nsec: string) {
  const onImport = jest.fn();
  openProfileImportMenu({ onImport });
  const payload = mockActionMenuPopup.mock.calls.at(-1)![0] as MenuPayload;
  const helpers = { setError: jest.fn(), close: jest.fn() };
  payload.primaryAction.onPress({ nsec }, helpers);
  return { onImport, helpers, payload };
}

beforeEach(() => {
  mockActionMenuPopup.mockClear();
  mockHasPubkey.mockReset().mockReturnValue(false);
});

describe('openProfileImportMenu', () => {
  it('hands on a valid nsec with its derived key and account, then closes', () => {
    const secret = generateSecretKey();
    const nsec = nip19.nsecEncode(secret);
    const pubkeyHex = getPublicKey(secret);
    const { onImport, helpers, payload } = submit(`  ${nsec} `);
    expect(payload.title).toBe('Import Nostr');
    expect(payload.primaryAction.testID).toBe('profile-import-submit');
    expect(onImport).toHaveBeenCalledWith({
      nsec,
      pubkeyHex,
      accountIndex: pubkeyToAccountNumber(pubkeyHex),
    });
    expect(helpers.close).toHaveBeenCalled();
    expect(helpers.setError).not.toHaveBeenCalled();
  });

  it('refuses text that is not an nsec', () => {
    const npub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    for (const value of ['', 'garbage', npub]) {
      const { onImport, helpers } = submit(value);
      expect(onImport).not.toHaveBeenCalled();
      expect(helpers.close).not.toHaveBeenCalled();
      expect(helpers.setError).toHaveBeenCalled();
    }
  });

  it('refuses an identity that is already a profile', () => {
    mockHasPubkey.mockReturnValue(true);
    const { onImport, helpers } = submit(nip19.nsecEncode(generateSecretKey()));
    expect(onImport).not.toHaveBeenCalled();
    expect(helpers.setError).toHaveBeenCalledWith('This identity already exists as a profile.');
  });
});
