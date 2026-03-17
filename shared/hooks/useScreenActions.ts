/**
 * Sovran useScreenActions — thin wrapper around coco-payment-ux.
 *
 * Injects:
 *   - Sovran screen action handlers (copy, share, NFC, redeem, pay, cancel)
 *   - coco-cashu-react wallet manager
 *   - History update subscription via manager.on('history:updated')
 */

import { useCallback, useMemo } from 'react';

import type { HistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import {
  useScreenActions as useCocoScreenActions,
  type BoundAction,
  type UseScreenActionsResult as CocoResult,
} from 'coco-payment-ux/react';
import {
  defaultDetectors,
  FormattedString,
  FormattedTimestamp,
  type PaymentRequestInfo,
  type ScreenActionHandlerMap,
  type ScreenActionName,
  type ScreenType,
  type TruncateMode,
} from 'coco-payment-ux';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';

import { createSovranScreenActionHandlers } from '@/features/send/lib/screenActionHandlers';
import { extractP2PKPubkey } from '@/shared/lib/cashu/utils';
import { sendDirectMessageToRelays } from '@/shared/lib/nostr/sendDirectMessage';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useScanHistoryStore, type ScanSource } from '@/shared/stores/profile/scanHistoryStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

// ---------------------------------------------------------------------------
// Lazy handler singleton
// ---------------------------------------------------------------------------

let _handlers: ScreenActionHandlerMap | null = null;
function getHandlers(): ScreenActionHandlerMap {
  if (!_handlers) {
    _handlers = createSovranScreenActionHandlers();
  }
  return _handlers;
}

// ---------------------------------------------------------------------------
// Hook return type (preserves typed entry generic)
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<ScanSource, string> = {
  qr: 'QR Code',
  nfc: 'NFC',
  paste: 'Clipboard',
  deeplink: 'Deep Link',
};

/**
 * Branded number with FormattedTimestamp getters.
 * Assignable to `number` (components work unchanged) but also exposes
 * .relative, .short, .full, .datetime via the FormattedTimestamp instance.
 */
type FormattedTimestampValue = number & {
  readonly relative: string;
  readonly short: string;
  readonly full: string;
  readonly datetime: string;
};

/**
 * Branded string with FormattedString helpers.
 * Assignable to `string` but also exposes .truncate().
 */
type FormattedStringValue = string & {
  readonly truncate: (n: number, mode?: TruncateMode) => string;
};

/**
 * Entry with decorated fields:
 * - `createdAt` → FormattedTimestamp (.relative, .short, .full, .datetime)
 * - `tokenString` → FormattedString of encoded token (.truncate())
 * - `p2pkPubkey` → FormattedString of P2PK public key (.truncate())
 * - `paymentRequestInfo` → decoded payment request (for payment request entries)
 * - `transportLabel` → display label for transport type
 */
type DecoratedEntry<E> = Omit<E, 'createdAt'> & {
  createdAt: FormattedTimestampValue;
  tokenString: FormattedStringValue | null;
  p2pkPubkey: FormattedStringValue | null;
  paymentRequestInfo: PaymentRequestInfo | null;
  transportLabel: string | null;
};

export interface UseScreenActionsResult<
  S extends ScreenType,
  E extends HistoryEntry = HistoryEntry,
> {
  entry: DecoratedEntry<E> | null;
  error: string | null;
  actions: Record<ScreenActionName[S], BoundAction>;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScreenActions<S extends ScreenType, E extends HistoryEntry = HistoryEntry>(
  screenType: S,
  entryParam: E | string | undefined
): UseScreenActionsResult<S, E> {
  const manager = useManager();
  const { keys } = useNostrKeysContext();

  const sendDirectMessage = useCallback(
    async (nprofile: string, message: string) => {
      const pk = keys?.privateKey;
      if (!pk) throw new Error('Nostr keys not available');
      await sendDirectMessageToRelays({ senderPrivateKey: pk, nprofile, message });
    },
    [keys?.privateKey]
  );

  const handlers = getHandlers();

  const result: CocoResult<S> = useCocoScreenActions({
    screenType,
    handlers: handlers[screenType] as ScreenActionHandlerMap[S],
    entryParam: entryParam as Record<string, unknown> | string | undefined,
    getExtraContext: () => ({ manager, sendDirectMessage }),
    onEntryUpdate: (callback) => {
      const unsubscribe = manager.on(
        'history:updated',
        ({ entry: updated }: { mintUrl: string; entry: HistoryEntry }) => {
          callback(updated as unknown as Record<string, unknown>);
        }
      );
      return unsubscribe;
    },
  });

  const entryId = (result.entry as { id?: string } | null)?.id;
  const source = useScanHistoryStore((state) => {
    if (!entryId) return null;
    const scan = state.entries.find((e) => e.transactionId === entryId);
    return scan?.source ? SOURCE_LABELS[scan.source] : null;
  });

  const language = useSettingsStore((s) => s.language) || 'en';
  const decoratedEntry = useMemo(() => {
    const raw = result.entry as E | null;
    if (!raw) return null;

    // Token string — encode if entry has a token
    let tokenString: FormattedStringValue | null = null;
    const token = (raw as Record<string, unknown>).token;
    if (token) {
      try {
        tokenString = new FormattedString(
          getEncodedTokenV4(token as Parameters<typeof getEncodedTokenV4>[0]),
          'middle'
        ) as unknown as FormattedStringValue;
      } catch {
        /* entry token may not be encodable */
      }
    }

    // P2PK pubkey — prefer pre-computed metadata, fall back to extraction
    let p2pkPubkey: FormattedStringValue | null = null;
    const meta = (raw as Record<string, unknown>).metadata as Record<string, string> | undefined;
    if (meta?.p2pkPubkey) {
      p2pkPubkey = new FormattedString(
        meta.p2pkPubkey,
        'middle'
      ) as unknown as FormattedStringValue;
    } else if (token && (token as { proofs?: unknown[] }).proofs) {
      const extracted = extractP2PKPubkey((token as { proofs: Array<{ secret: string }> }).proofs);
      if (extracted) {
        p2pkPubkey = new FormattedString(extracted, 'middle') as unknown as FormattedStringValue;
      }
    }

    // Payment request decoration
    let paymentRequestInfo: PaymentRequestInfo | null = null;
    let transportLabel: string | null = null;
    const rawMeta = (raw as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined;
    const prString = rawMeta?.paymentRequest;
    if (prString && typeof prString === 'string') {
      paymentRequestInfo = defaultDetectors.getPaymentRequestInfo(prString);
      if (paymentRequestInfo) {
        const transports = paymentRequestInfo.transports;
        if (!transports?.length) {
          transportLabel = 'Inband';
        } else if (transports.find((t) => t.type === 'nostr')) {
          transportLabel = 'Nostr';
        } else if (transports.find((t) => t.type === 'post')) {
          transportLabel = 'HTTP POST';
        } else {
          transportLabel = transports[0].type;
        }
      }
    }

    return {
      ...raw,
      createdAt: new FormattedTimestamp(
        raw.createdAt,
        language
      ) as unknown as FormattedTimestampValue,
      tokenString,
      p2pkPubkey,
      paymentRequestInfo,
      transportLabel,
    };
  }, [result.entry, language]);

  return {
    entry: decoratedEntry,
    error: result.error,
    actions: result.actions,
    source,
  };
}

// Re-export types
