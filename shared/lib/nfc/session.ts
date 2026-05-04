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

async function cancelStaleSession(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // No active session — expected path on a clean acquire.
  }
}

export async function acquireSession(): Promise<void> {
  await cancelStaleSession();
  await NfcManager.requestTechnology(NfcTech.IsoDep);
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
