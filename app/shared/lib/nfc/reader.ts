/**
 * Who holds the NFC reader. One flow at a time: the wallet screen's ambient
 * loop, for each scan cycle, or an explicit scan (Tap to pay, the camera
 * screen's NFC start), for its whole run. Taking the reader replaces any hold
 * before it, and a replaced hold's release does nothing, so a late teardown
 * cannot clear its successor.
 *
 * The holder is told when a tag enters the field. Once that tag is read, the
 * session is the payment machine's, which ends it with the tap; and from the
 * moment the machine reports that it is creating or writing ecash for the tag,
 * the hold is writing back. Either way, until the next tag, closing the
 * holder's sheet must not cancel the session. Module state, not a store, so
 * this lib layer stays UI-free.
 */

import { nfcLog } from '../logger';

type NfcReader =
  { holder: 'idle' } | { holder: 'ambient' | 'explicit'; read: boolean; writingBack: boolean };

interface Hold {
  holder: 'ambient' | 'explicit';
  onTagConnected?: () => void;
  read: boolean;
  writingBack: boolean;
}

let current: Hold | null = null;

/** Takes the reader; returns the hold's release. */
export function holdNfcReader(
  holder: 'ambient' | 'explicit',
  onTagConnected?: () => void
): () => void {
  const hold: Hold = { holder, onTagConnected, read: false, writingBack: false };
  current = hold;
  nfcLog.debug('nfc.reader.held', { holder });
  return () => {
    if (current !== hold) return;
    current = null;
    nfcLog.debug('nfc.reader.released', { holder });
  };
}

export function nfcReader(): NfcReader {
  return current
    ? { holder: current.holder, read: current.read, writingBack: current.writingBack }
    : { holder: 'idle' };
}

/** A tag entered the field: a new tap, which writes nothing yet. */
export function nfcTagConnected(): void {
  if (!current) return;
  current.read = false;
  current.writingBack = false;
  current.onTagConnected?.();
}

/** The holder's tag was read: the payment machine has its session now. */
export function nfcTagRead(): void {
  if (current) current.read = true;
}

/** The payment machine reports where the holder's tap is. */
export function nfcTapProgressed(phase: 'reading' | 'selecting' | 'creating' | 'writing'): void {
  if (current) current.writingBack = phase === 'creating' || phase === 'writing';
}
