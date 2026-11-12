/**
 * @jest-environment node
 *
 * Characterization of how `useZap` starts a zap from the feed's zap menu:
 * which Lightning address it pays, what pending-zap record it leaves for the
 * invoice fetch and melt screen, and what it asks the payment machine. The
 * real hook, pending-zap registry, payment-context clear, mint store and
 * npub.cash fallback run; the payment machine, wallet context, cached
 * profile read, popups and the zap menu sheet are replaced.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as nip19 from 'nostr-tools/nip19';

import { useZap } from '@/features/feed/hooks/useZap';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { openZapMenu as openZapMenuPopup } from '@/features/feed/lib/zapMenu';
import type { ZapPreset } from '@/features/feed/lib/zapPresets';
import { paramPopup } from '@/shared/lib/popup';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { peekPendingZap, registerPendingZap } from '@/shared/stores/runtime/pendingZapStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';

const mockMachine = {
  enterAmount: jest.fn(async () => undefined),
  startSendEcash: jest.fn(async () => undefined),
};
let mockProfile: { lud16?: string; name?: string; picture?: string; nip05?: string } | undefined;

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: () => mockMachine,
}));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => ({}),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  readProfileRecord: () => mockProfile,
}));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn() }));
jest.mock('@/features/feed/lib/zapMenu', () => ({ openZapMenu: jest.fn(async () => undefined) }));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => {
  const actual = jest.requireActual('@/shared/stores/runtime/clearPaymentContext');
  return { clearPaymentContext: jest.fn(actual.clearPaymentContext) };
});
jest.mock('@/shared/stores/runtime/pendingZapStore', () => {
  const actual = jest.requireActual('@/shared/stores/runtime/pendingZapStore');
  return { ...actual, registerPendingZap: jest.fn(actual.registerPendingZap) };
});

const MINT = 'https://mint.example';
const AUTHOR = 'e'.repeat(64);
const NPC = `${nip19.npubEncode(AUTHOR)}@npub.cash`;
const PRESET: ZapPreset = { emoji: '☕', sats: 1_000, message: 'Coffee on me ☕' };
const POST: FeedEvent = {
  id: 'f'.repeat(64),
  kind: 1,
  pubkey: AUTHOR,
  content: 'A post worth zapping',
  tags: [],
  created_at: 1,
};

function menuCallbacks() {
  const { result } = renderHook(() => useZap());
  act(() => result.current.openZapMenu(POST, 50));
  const args = jest.mocked(openZapMenuPopup).mock.calls.at(-1)![0];
  return args;
}

async function zapPreset(preset = PRESET) {
  const { onPreset } = menuCallbacks();
  await act(async () => {
    onPreset(preset);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMachine.enterAmount.mockImplementation(async () => undefined);
  mockProfile = { lud16: 'Alice@Example.COM', name: 'Alice', picture: 'https://pic.example/a.png' };
  useMintStore.setState({ selectedMint: MINT });
  clearPaymentContext('test.reset');
  jest.mocked(clearPaymentContext).mockClear();
});

test('a valid lud16 is paid, lower-cased', async () => {
  await zapPreset();

  // QUIRK: the whole address is lower-cased, including the local part, which
  // some LNURL servers treat as case-sensitive.
  expect(mockMachine.enterAmount).toHaveBeenCalledWith(
    { value: 1_000, unit: 'sat' },
    MINT,
    expect.objectContaining({ meltTarget: 'alice@example.com' })
  );
});

test('an invalid lud16 falls back to the author’s npub.cash address', async () => {
  mockProfile = { lud16: 'not an address' };
  await zapPreset();

  expect(mockMachine.enterAmount).toHaveBeenCalledWith(
    expect.anything(),
    MINT,
    expect.objectContaining({ meltTarget: NPC })
  );
});

test('an author with no profile is paid at the npub.cash address', async () => {
  mockProfile = undefined;
  await zapPreset();

  expect(peekPendingZap(NPC)).toMatchObject({ authorPubkey: AUTHOR });
});

test('a preset zap starts the melt preview with the preset amount, the selected mint and the recipient', async () => {
  await zapPreset();

  expect(mockMachine.enterAmount).toHaveBeenCalledTimes(1);
  expect(mockMachine.enterAmount).toHaveBeenCalledWith({ value: 1_000, unit: 'sat' }, MINT, {
    destination: 'meltQuote',
    meltQuoteMethod: 'bolt11',
    meltTarget: 'alice@example.com',
    recipientPubkey: AUTHOR,
    recipientProfile: {
      displayName: 'Alice',
      avatarUrl: 'https://pic.example/a.png',
      nip05: null,
    },
  });
});

test('a preset zap leaves a pending record with the post, the preset and the comment', async () => {
  await zapPreset();

  expect(peekPendingZap('alice@example.com')).toMatchObject({
    meltTarget: 'alice@example.com',
    eventId: POST.id,
    eventKind: 1,
    authorPubkey: AUTHOR,
    authorName: 'Alice',
    contentPreview: 'A post worth zapping',
    emoji: '☕',
    comment: 'Coffee on me ☕',
    presetSats: 1_000,
    baseSats: 50,
  });
});

test('the payment context is cleared before the zap is registered, so the record survives', async () => {
  registerPendingZap({
    meltTarget: 'stale@example.com',
    eventId: 'old',
    eventKind: 1,
    authorPubkey: AUTHOR,
    contentPreview: '',
    emoji: '⚡',
    comment: '',
    createdAt: Date.now(),
  });
  await zapPreset();

  expect(jest.mocked(clearPaymentContext)).toHaveBeenCalledWith('feed.zap_post');
  expect(jest.mocked(clearPaymentContext).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(registerPendingZap).mock.invocationCallOrder.at(-1)!
  );
  expect(peekPendingZap('stale@example.com')).toBeUndefined();
  expect(peekPendingZap('alice@example.com')).toBeDefined();
});

test('with no mint selected it says to add a mint and starts nothing', async () => {
  useMintStore.setState({ selectedMint: undefined });
  await zapPreset();

  expect(paramPopup).toHaveBeenCalledWith('action-unavailable', {
    title: "Can't zap",
    message: 'Add a mint with some sats first.',
  });
  expect(mockMachine.enterAmount).not.toHaveBeenCalled();
  expect(peekPendingZap('alice@example.com')).toBeUndefined();
  expect(clearPaymentContext).not.toHaveBeenCalled();
});

test('a machine that throws leaves the pending record in place and shows nothing', async () => {
  mockMachine.enterAmount.mockRejectedValueOnce(new Error('no route'));
  await zapPreset();

  // QUIRK: a failed start is only logged; the person sees no message and the
  // pending record stays until the next payment clears it or it expires.
  expect(paramPopup).not.toHaveBeenCalled();
  expect(peekPendingZap('alice@example.com')).toBeDefined();
});

test('a custom zap registers a lightning-bolt record with no comment and opens amount entry', async () => {
  const { onCustom } = menuCallbacks();
  await act(async () => {
    onCustom();
  });

  expect(mockMachine.startSendEcash).toHaveBeenCalledWith({
    reset: true,
    meltTarget: 'alice@example.com',
    recipientPubkey: AUTHOR,
    recipientProfile: {
      displayName: 'Alice',
      avatarUrl: 'https://pic.example/a.png',
      nip05: null,
    },
  });
  const pending = peekPendingZap('alice@example.com');
  expect(pending).toMatchObject({ emoji: '⚡', comment: '', baseSats: 50 });
  expect(pending).not.toHaveProperty('presetSats', expect.anything());
  expect(mockMachine.enterAmount).not.toHaveBeenCalled();
});
