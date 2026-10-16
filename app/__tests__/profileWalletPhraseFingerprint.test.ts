/**
 * @jest-environment node
 *
 * An imported account's wallet is derived from the phone's recovery phrase.
 * Its row records which phrase, once, so a recovery with another phrase can be
 * refused. The record is evidence: nothing may replace it.
 */
import { useProfileStore } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

const DERIVED = 'a'.repeat(64);
const IMPORTED = 'b'.repeat(64);
const fingerprintOf = (pubkey: string) =>
  useProfileStore.getState().profiles.find((profile) => profile.pubkey === pubkey)
    ?.walletPhraseFingerprint;

beforeEach(() => {
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: DERIVED, addedAt: 1, source: 'derived' },
      { accountIndex: 77, pubkey: IMPORTED, addedAt: 2, source: 'imported', externalChain: 1 },
    ],
  });
});

it('records the fingerprint on an imported account', () => {
  useProfileStore.getState().recordWalletPhraseFingerprint(IMPORTED, '1111222233334444');
  expect(fingerprintOf(IMPORTED)).toBe('1111222233334444');
});

it('never replaces a fingerprint that is already recorded', () => {
  const record = useProfileStore.getState().recordWalletPhraseFingerprint;
  record(IMPORTED, '1111222233334444');
  record(IMPORTED, 'ffffeeeeddddcccc');
  expect(fingerprintOf(IMPORTED)).toBe('1111222233334444');
});

it('records nothing for an account made from the phrase, or one that is not listed', () => {
  const record = useProfileStore.getState().recordWalletPhraseFingerprint;
  record(DERIVED, '1111222233334444');
  record('c'.repeat(64), '1111222233334444');
  expect(fingerprintOf(DERIVED)).toBeUndefined();
  expect(useProfileStore.getState().profiles).toHaveLength(2);
});
