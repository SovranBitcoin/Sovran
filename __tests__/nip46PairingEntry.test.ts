/**
 * Layer-4 pairing entry points — pure parts only. Covers the +native-intent
 * system-path rewrite (nostrconnect:// → /(signer-flow)/connect?uri=…, never
 * throws, everything else passes through) and the shared openPairingFromUri
 * dispatch (camera scan / hub paste / deep link) with the engine and popup
 * bridge mocked. Fixture URIs carry fake secrets only; the redaction test
 * asserts no log call ever sees the secret-bearing URI.
 */

/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => ({
    name: 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

jest.mock('@/features/nostrSigner/lib/nip46Engine', () => ({
  nip46Engine: { startNostrconnectPairing: jest.fn() },
}));

jest.mock('@/shared/lib/popup', () => ({
  showActionSheet: jest.fn(),
}));

import { err, ok } from 'neverthrow';

import { redirectSystemPath, rewriteSystemPath } from '@/app/+native-intent';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { openPairingFromUri } from '@/features/nostrSigner/lib/openPairingFromUri';
import { nostrLog, storeLog } from '@/shared/lib/logger';
import { showActionSheet } from '@/shared/lib/popup';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';

const CLIENT_PUBKEY = 'a1'.repeat(32);
const RELAY = 'wss://relay.example.com';
const SECRET = 'fixture-secret';
const VALID_URI = `nostrconnect://${CLIENT_PUBKEY}?relay=${encodeURIComponent(RELAY)}&secret=${SECRET}&name=Primal`;
const BUNKER_URI = `bunker://${CLIENT_PUBKEY}?relay=${encodeURIComponent(RELAY)}&secret=${SECRET}`;

const startPairingMock = nip46Engine.startNostrconnectPairing as jest.Mock;
const showActionSheetMock = showActionSheet as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  startPairingMock.mockReturnValue(ok(undefined));
  useNip46RequestsStore.getState().setServiceHotRequested(false);
  usePopupStore.setState({ current: null, isOpen: false });
});

// ── +native-intent rewrite ──────────────────────────────────────

describe('redirectSystemPath', () => {
  it('rewrites nostrconnect:// system URLs to the signer connect route', () => {
    expect(redirectSystemPath({ path: VALID_URI, initial: false })).toBe(
      '/(signer-flow)/connect?uri=' + encodeURIComponent(VALID_URI)
    );
  });

  it('rewrites regardless of scheme casing and initial flag', () => {
    const mixedCase = `NostrConnect://${CLIENT_PUBKEY}?relay=${encodeURIComponent(RELAY)}&secret=${SECRET}`;
    expect(redirectSystemPath({ path: mixedCase, initial: true })).toBe(
      '/(signer-flow)/connect?uri=' + encodeURIComponent(mixedCase)
    );
  });

  it.each(['/', '/camera?action=signer-pair', 'sovran://pay', 'https://example.com', BUNKER_URI])(
    'passes %s through unchanged',
    (path) => {
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
  );

  it('never throws and returns the input unchanged on junk', () => {
    expect(rewriteSystemPath('')).toBe('');
    expect(rewriteSystemPath('nostrconnect:/missing-slash')).toBe('nostrconnect:/missing-slash');
    const nonString = undefined as unknown as string;
    expect(rewriteSystemPath(nonString)).toBe(nonString);
  });
});

// ── openPairingFromUri dispatch ─────────────────────────────────

describe('openPairingFromUri', () => {
  it('valid nostrconnect → hot flag, engine pairing, connect sheet with the raw URI', () => {
    const outcome = openPairingFromUri(VALID_URI);

    expect(outcome.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().serviceHotRequested).toBe(true);
    expect(startPairingMock).toHaveBeenCalledTimes(1);
    expect(startPairingMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nostrconnect', clientPubkey: CLIENT_PUBKEY, secret: SECRET })
    );
    expect(showActionSheetMock).toHaveBeenCalledTimes(1);
    expect(showActionSheetMock).toHaveBeenCalledWith('signer-connect', { uri: VALID_URI });
  });

  it('trims surrounding whitespace before parsing and dispatching', () => {
    const outcome = openPairingFromUri(`  ${VALID_URI}\n`);

    expect(outcome.isOk()).toBe(true);
    expect(showActionSheetMock).toHaveBeenCalledWith('signer-connect', { uri: VALID_URI });
  });

  it('runs beforeOpen after validation but before the sheet opens', () => {
    const order: string[] = [];
    showActionSheetMock.mockImplementation(() => order.push('sheet'));

    openPairingFromUri(VALID_URI, { beforeOpen: () => order.push('beforeOpen') });

    expect(order).toEqual(['beforeOpen', 'sheet']);
  });

  it('malformed input → invalid-uri with zero side effects', () => {
    const outcome = openPairingFromUri('not a connection link');

    expect(outcome._unsafeUnwrapErr()).toEqual({ type: 'invalid-uri' });
    expect(useNip46RequestsStore.getState().serviceHotRequested).toBe(false);
    expect(startPairingMock).not.toHaveBeenCalled();
    expect(showActionSheetMock).not.toHaveBeenCalled();
  });

  it('bunker:// → bunker-unsupported with zero side effects', () => {
    const outcome = openPairingFromUri(BUNKER_URI);

    expect(outcome._unsafeUnwrapErr()).toEqual({ type: 'bunker-unsupported' });
    expect(useNip46RequestsStore.getState().serviceHotRequested).toBe(false);
    expect(startPairingMock).not.toHaveBeenCalled();
    expect(showActionSheetMock).not.toHaveBeenCalled();
  });

  it("tolerates the engine's cold 'not-started' and still opens the sheet", () => {
    startPairingMock.mockReturnValue(err({ type: 'not-started' }));

    const outcome = openPairingFromUri(VALID_URI);

    expect(outcome.isOk()).toBe(true);
    expect(showActionSheetMock).toHaveBeenCalledTimes(1);
    expect(nostrLog.warn).not.toHaveBeenCalled();
  });

  it('re-delivered scan while the sheet shows the same URI is a no-op', () => {
    usePopupStore.getState().open({ sheetId: 'signer-connect', payload: { uri: VALID_URI } });

    const outcome = openPairingFromUri(VALID_URI);

    expect(outcome.isOk()).toBe(true);
    expect(startPairingMock).not.toHaveBeenCalled();
    expect(showActionSheetMock).not.toHaveBeenCalled();
  });

  it('a different URI while the sheet is up still dispatches (replaces the review)', () => {
    usePopupStore.getState().open({ sheetId: 'signer-connect', payload: { uri: VALID_URI } });
    const otherUri = `nostrconnect://${'b2'.repeat(32)}?relay=${encodeURIComponent(RELAY)}&secret=other-${SECRET}`;

    const outcome = openPairingFromUri(otherUri);

    expect(outcome.isOk()).toBe(true);
    expect(showActionSheetMock).toHaveBeenCalledWith('signer-connect', { uri: otherUri });
  });

  it('never logs the secret-bearing URI on any path', () => {
    startPairingMock.mockReturnValue(err({ type: 'no-keys' }));
    openPairingFromUri(VALID_URI);
    openPairingFromUri(BUNKER_URI);
    openPairingFromUri('not a connection link');

    const allLogCalls = [
      ...Object.values(nostrLog).flatMap((fn) => (fn as jest.Mock).mock.calls),
      ...Object.values(storeLog).flatMap((fn) => (fn as jest.Mock).mock.calls),
    ];
    expect(JSON.stringify(allLogCalls)).not.toContain(SECRET);
  });
});
