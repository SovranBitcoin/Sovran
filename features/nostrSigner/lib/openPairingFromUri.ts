/**
 * @fileoverview Shared nostrconnect pairing dispatch — one code path for
 * every entry point (camera scan, hub paste, deep link)
 *
 * Validates a raw scanned/pasted/deep-linked string, flips the service-hot
 * flag, registers the awaited pairing on the engine, and opens the
 * 'signer-connect' sheet with the RAW URI — the sheet re-parses it, so every
 * entry point shares one in-sheet validation path. The URI embeds the pairing
 * bearer secret: never log it or any derived string; errors carry types only,
 * and callers translate them into surface-appropriate copy (toast vs inline).
 *
 * bunker:// input is rejected as unsupported: bunker links are what WE mint
 * for clients — receiving one here is the wrong direction for pairing-in
 * (documented v1 decision, copy below).
 */

import { err, ok, type Result } from 'neverthrow';

import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { parseNip46Uri } from '@/features/nostrSigner/lib/nip46Uri';
import { nostrLog } from '@/shared/lib/logger';
import { showActionSheet, type ActionSheetPayloads } from '@/shared/lib/popup';
import { isCustomSheetPayload, usePopupStore } from '@/shared/stores/runtime/popupStore';

// ── Error copy (single source for every entry surface) ──────────

/** Toast headline shared by the camera-scan and deep-link error paths. */
export const PAIRING_ERROR_TITLE = "Couldn't connect";
/** Plan copy for malformed QR scans. */
export const PAIRING_ERROR_INVALID_QR = "That QR code isn't a Nostr connection link.";
/** Plan copy for malformed pasted/deep-linked links. */
export const PAIRING_ERROR_INVALID_LINK = "That doesn't look like a Nostr connection link.";
/**
 * bunker:// is what WE mint for clients — receiving one is the wrong
 * direction, so v1 treats it as unsupported with an explanatory error
 * (the plan has no copy for this case; new string, documented).
 */
export const PAIRING_ERROR_BUNKER =
  "That's a bunker link — it belongs in the app you're signing in to. Paste that app's nostrconnect link here instead.";

// ── Dispatch ────────────────────────────────────────────────────

export type OpenPairingFromUriError = { type: 'invalid-uri' } | { type: 'bunker-unsupported' };

export interface OpenPairingFromUriOptions {
  /**
   * Runs after validation succeeds, immediately before the connect sheet
   * opens — e.g. the hub's paste menu closes itself here so the dismissal
   * cannot land on top of the freshly opened sheet.
   */
  beforeOpen?: () => void;
}

/**
 * Validate `raw` and open the 'signer-connect' sheet for it. On success the
 * service-hot flag is raised FIRST (the engine may be cold with zero
 * connections; the service hook starts it and a cold start picks the pairing
 * relays up via the relay union), then the pairing registers on the engine
 * (idempotent — the sheet re-registers on mount), then the sheet opens.
 * The connect sheet owns releasing the hot flag when it closes.
 */
export function openPairingFromUri(
  raw: string,
  options: OpenPairingFromUriOptions = {}
): Result<void, OpenPairingFromUriError> {
  const trimmed = raw.trim();
  // The URI embeds the pairing secret — never log it; errors carry types only.
  const parsed = parseNip46Uri(trimmed);
  if (parsed.isErr()) return err({ type: 'invalid-uri' });
  if (parsed.value.type === 'bunker') return err({ type: 'bunker-unsupported' });

  // A live camera re-delivers the same QR every few hundred ms — if the
  // connect sheet is already up for this exact URI, re-opening would reset
  // the user's checkbox review mid-flight. Treat it as already handled.
  const popupState = usePopupStore.getState();
  if (
    popupState.isOpen &&
    isCustomSheetPayload(popupState.current) &&
    popupState.current.sheetId === 'signer-connect' &&
    (popupState.current.payload as ActionSheetPayloads['signer-connect']).uri === trimmed
  ) {
    return ok(undefined);
  }

  useNip46RequestsStore.getState().setServiceHotRequested(true);
  const started = nip46Engine.startNostrconnectPairing(parsed.value);
  if (started.isErr() && started.error.type !== 'not-started') {
    nostrLog.warn('nostr.signer.pairing_entry_start_failed', { error: started.error.type });
  }
  options.beforeOpen?.();
  showActionSheet('signer-connect', { uri: trimmed });
  return ok(undefined);
}
