/**
 * IsoDep session lifetime — the single owner of acquire / release / stale-prelude.
 *
 * Two surfaces:
 * - `withSession(fn)` for one-shot flows (acquire → run → release in `finally`).
 * - `acquireSession()` + `releaseSession()` for multi-step flows where the
 *   session must span user interaction (read → choose → write).
 *
 * Both forms cancel any stale session before acquiring and release on throw,
 * so callers cannot leak a held native session by raising in the middle of
 * the flow.
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';

import { nfcLog } from '../logger';
import { NfcError } from './errors';
import { isNfcEnabled, isNfcSupported } from './status';

// Android has no system NFC sheet: with the adapter disabled or absent,
// requestTechnology never resolves OR rejects — the tap is silently dead.
// Cap how long an unanswered session request can dangle.
const REQUEST_TECHNOLOGY_TIMEOUT_MS = 30_000;

// NfcManager.start() registers the Android adapter-state receiver and captures
// the launch-intent tag. It is the library's documented init contract and is
// NOT idempotent (re-registers the receiver per call) — once-guard it, lazily,
// so users who never touch NFC never pay for it. Reset on failure to allow a
// retry after the user enables NFC.
let nfcStartPromise: Promise<void> | null = null;
function ensureNfcStarted(): Promise<void> {
  nfcStartPromise ??= Promise.resolve(NfcManager.start()).catch((error) => {
    nfcStartPromise = null;
    nfcLog.warn('nfc.start_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new NfcError('NFC is not supported on this device', 'NOT_SUPPORTED');
  });
  return nfcStartPromise;
}

async function cancelStaleSession(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // No active session — expected path on a clean acquire.
  }
}

export async function acquireSession(): Promise<void> {
  if (!(await isNfcSupported())) {
    throw new NfcError('NFC is not supported on this device', 'NOT_SUPPORTED');
  }
  if (!(await isNfcEnabled())) {
    throw new NfcError('NFC is disabled in system settings', 'NOT_ENABLED');
  }
  await ensureNfcStarted();
  await cancelStaleSession();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      NfcManager.requestTechnology(NfcTech.IsoDep),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          void cancelStaleSession();
          reject(new NfcError('No NFC tag detected', 'TIMEOUT'));
        }, REQUEST_TECHNOLOGY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  nfcLog.info('nfc.session.acquired');
}

export async function releaseSession(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
    nfcLog.info('nfc.session.released');
  } catch (e) {
    nfcLog.error('nfc.session.release_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSession();
  try {
    return await fn();
  } finally {
    await releaseSession();
  }
}
