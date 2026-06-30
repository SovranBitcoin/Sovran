/**
 * Switch & Connect seam over a MOCKED orchestrator + popup + intent storage.
 * Load-bearing cases: the pairing intent write is durable BEFORE the sheet
 * closes or the switch is invoked; a failed write ABORTS the switch (sheet
 * stays open, retry toast); a refused/rejected switch clears the orphaned
 * intent and toasts; and no log or popup call ever carries the nostrconnect
 * URI or its embedded bearer secret (asserted globally in afterEach).
 */

/* eslint-disable import/first */

jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  switchToExistingProfile: jest.fn(),
}));

jest.mock('@/features/nostrSigner/lib/pairingIntentStorage', () => ({
  setPairingIntent: jest.fn(),
  clearPairingIntent: jest.fn(),
}));

jest.mock('@/shared/lib/popup', () => ({
  popup: jest.fn(),
  showActionSheet: jest.fn(),
}));

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => ({
    name: 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow';

import { parseNostrconnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import {
  clearPairingIntent,
  setPairingIntent,
  type PairingIntentError,
  type PairingIntentInput,
} from '@/features/nostrSigner/lib/pairingIntentStorage';
import {
  PAIRING_SAVE_FAILED_TOAST,
  switchProfileAndPair,
} from '@/features/nostrSigner/lib/switchProfileAndPair';
import { nostrLog, storeLog } from '@/shared/lib/logger';
import { popup, showActionSheet } from '@/shared/lib/popup';
import { switchToExistingProfile } from '@/shared/lib/profile/profileSessionOrchestrator';

const mockSetPairingIntent = jest.mocked(setPairingIntent);
const mockClearPairingIntent = jest.mocked(clearPairingIntent);
const mockSwitch = jest.mocked(switchToExistingProfile);
const mockPopup = jest.mocked(popup);
const mockShowActionSheet = jest.mocked(showActionSheet);

const CLIENT_PUBKEY = 'a'.repeat(64);
const SECRET = 's3cr3t-bearer-token';
const RAW_URI =
  `nostrconnect://${CLIENT_PUBKEY}` +
  `?relay=${encodeURIComponent('wss://relay.example.com')}` +
  `&secret=${encodeURIComponent(SECRET)}` +
  `&perms=${encodeURIComponent('sign_event:1')}` +
  `&name=Primal`;

const PARSED = parseNostrconnectUri(RAW_URI)._unsafeUnwrap();
const TARGET = { accountIndex: 3, pubkey: 'b'.repeat(64) };

const EXPECTED_TOAST = {
  message: PAIRING_SAVE_FAILED_TOAST.label,
  text: PAIRING_SAVE_FAILED_TOAST.description,
  type: 'error',
};

const WRITE_FAILED: PairingIntentError = {
  type: 'storage-write-failed',
  cause: { name: 'Error', message: 'disk full' },
};

/** Spied call order across the three teardown stages. */
let order: string[] = [];

const closeSheet = jest.fn(() => {
  order.push('close');
});

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  order = [];
  mockSetPairingIntent.mockImplementation(() => {
    order.push('persist');
    return okAsync(undefined);
  });
  mockClearPairingIntent.mockReturnValue(okAsync(undefined));
  mockSwitch.mockImplementation(async () => {
    order.push('switch');
    return true;
  });
});

afterEach(() => {
  // The nostrconnect URI embeds a bearer secret: no log or popup call may
  // carry it, in any scenario this suite runs.
  const spies = [
    ...Object.values(nostrLog as unknown as Record<string, jest.Mock>),
    ...Object.values(storeLog as unknown as Record<string, jest.Mock>),
    mockPopup as unknown as jest.Mock,
    mockShowActionSheet as unknown as jest.Mock,
  ];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      const serialized = JSON.stringify(call) ?? '';
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain('nostrconnect://');
    }
  }
});

describe('switchProfileAndPair', () => {
  it('persists the intent durably BEFORE closing the sheet or switching', async () => {
    let resolvePersist!: () => void;
    mockSetPairingIntent.mockImplementation(() => {
      order.push('persist-start');
      return new ResultAsync(
        new Promise<Result<void, PairingIntentError>>((resolve) => {
          resolvePersist = () => {
            order.push('persist-durable');
            resolve(ok(undefined));
          };
        })
      );
    });

    const pending = switchProfileAndPair(PARSED, TARGET, closeSheet);
    await flushMicrotasks();
    // Nothing tears down while the write is in flight.
    expect(closeSheet).not.toHaveBeenCalled();
    expect(mockSwitch).not.toHaveBeenCalled();

    resolvePersist();
    const result = await pending;

    expect(result.isOk()).toBe(true);
    expect(order).toEqual(['persist-start', 'persist-durable', 'close', 'switch']);
    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockSwitch).toHaveBeenCalledWith({ accountIndex: TARGET.accountIndex });
    expect(mockPopup).not.toHaveBeenCalled();
  });

  it('writes the re-encoded URI (secret intact) and the profile-store target identity', async () => {
    await switchProfileAndPair(PARSED, TARGET, closeSheet);

    expect(mockSetPairingIntent).toHaveBeenCalledTimes(1);
    const input = mockSetPairingIntent.mock.calls[0]![0] as PairingIntentInput;
    expect(input.targetPubkey).toBe(TARGET.pubkey);
    expect(input.targetAccountIndex).toBe(TARGET.accountIndex);
    expect(input.uri.startsWith(`nostrconnect://${CLIENT_PUBKEY}?`)).toBe(true);
    expect(input.uri).toContain(`secret=${encodeURIComponent(SECRET)}`);
    // Round-trip sanity: the connect sheet must be able to re-parse it.
    const reparsed = parseNostrconnectUri(input.uri)._unsafeUnwrap();
    expect(reparsed.secret).toBe(SECRET);
    expect(reparsed.clientPubkey).toBe(CLIENT_PUBKEY);
  });

  it('aborts the switch and keeps the sheet open when the intent write fails', async () => {
    mockSetPairingIntent.mockReturnValue(errAsync(WRITE_FAILED));

    const result = await switchProfileAndPair(PARSED, TARGET, closeSheet);

    expect(result._unsafeUnwrapErr()).toEqual({
      type: 'intent-not-saved',
      cause: 'storage-write-failed',
    });
    expect(mockSwitch).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();
    expect(mockPopup).toHaveBeenCalledTimes(1);
    expect(mockPopup).toHaveBeenCalledWith(EXPECTED_TOAST);
  });

  it('clears the orphaned intent and toasts when the orchestrator refuses the switch', async () => {
    mockSwitch.mockImplementation(async () => {
      order.push('switch');
      return false;
    });

    const result = await switchProfileAndPair(PARSED, TARGET, closeSheet);

    expect(result._unsafeUnwrapErr()).toEqual({ type: 'switch-failed' });
    // The sheet was already (correctly) closed before the switch attempt.
    expect(order).toEqual(['persist', 'close', 'switch']);
    expect(mockClearPairingIntent).toHaveBeenCalledTimes(1);
    expect(mockPopup).toHaveBeenCalledTimes(1);
    expect(mockPopup).toHaveBeenCalledWith(EXPECTED_TOAST);
  });

  it('treats a rejected switch promise like a refused switch', async () => {
    mockSwitch.mockRejectedValue(new Error('native restart unavailable'));

    const result = await switchProfileAndPair(PARSED, TARGET, closeSheet);

    expect(result._unsafeUnwrapErr()).toEqual({ type: 'switch-failed' });
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(mockClearPairingIntent).toHaveBeenCalledTimes(1);
    expect(mockPopup).toHaveBeenCalledWith(EXPECTED_TOAST);
  });

  it('still reports switch-failed when the orphaned-intent cleanup itself fails', async () => {
    mockSwitch.mockResolvedValue(false);
    mockClearPairingIntent.mockReturnValue(errAsync(WRITE_FAILED));

    const result = await switchProfileAndPair(PARSED, TARGET, closeSheet);

    expect(result._unsafeUnwrapErr()).toEqual({ type: 'switch-failed' });
    expect(mockPopup).toHaveBeenCalledWith(EXPECTED_TOAST);
  });
});
