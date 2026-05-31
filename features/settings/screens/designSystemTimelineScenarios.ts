import { MeltQuoteState, MintQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ChainOnchainConfirmationProgress } from 'colada';
import type { HistoryEntry } from '@cashu/coco-core';

import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
} from '@/shared/lib/cashu/onchainMint';

/**
 * Dev-only fixtures that drive the Timeline showcase on the Design System screen.
 *
 * The Timeline ({@link HistoryEntryTimeline}) is fully state-driven: it renders whatever
 * `buildTimeline()` returns for the props it is given. To "simulate a flow" we hand it an
 * ordered list of {@link TimelineFrame}s (an evolving `historyEntry` + the auxiliary inputs)
 * and step through them on a timer, exactly mirroring how a real payment progresses.
 */

const DEMO_MINT_URL = 'https://mint.example';
const DEMO_UNIT = 'sat';
const DEMO_AMOUNT = 21_000;
const DEMO_ONCHAIN_ADDRESS = 'bc1qexampledesignsystemaddress0000000000';
const REQUIRED_CONFIRMATIONS = 6;

interface TimelineFrame {
  /** Short caption describing the simulated step, shown under the preview. */
  note: string;
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  onchainConfirmationProgress?: ChainOnchainConfirmationProgress | null;
}

interface TimelineScenario {
  id: string;
  label: string;
  frames: TimelineFrame[];
}

interface BaseFields {
  createdAt: number;
}

function mintEntry(
  state: string,
  { createdAt }: BaseFields,
  metadata?: Record<string, string>
): HistoryEntry {
  return {
    id: `ds-mint-${state}`,
    type: 'mint',
    createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    quoteId: 'ds-mint-quote',
    paymentRequest: '',
    state,
    ...(metadata ? { metadata } : {}),
  } as unknown as HistoryEntry;
}

function meltEntry(state: string, { createdAt }: BaseFields): HistoryEntry {
  return {
    id: `ds-melt-${state}`,
    type: 'melt',
    createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    quoteId: 'ds-melt-quote',
    state,
  } as unknown as HistoryEntry;
}

function sendEntry(state: string, { createdAt }: BaseFields): HistoryEntry {
  return {
    id: `ds-send-${state}`,
    type: 'send',
    createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    operationId: 'ds-send-op',
    state,
  } as unknown as HistoryEntry;
}

function receiveEntry(state: string, { createdAt }: BaseFields): HistoryEntry {
  return {
    id: `ds-receive-${state}`,
    type: 'receive',
    createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    state,
  } as unknown as HistoryEntry;
}

/** Minimal melt quote — the Timeline only reads `expiry` for the countdown / expired branch. */
function meltQuote(expirySeconds: number): MeltQuoteBolt11Response {
  return { expiry: expirySeconds } as unknown as MeltQuoteBolt11Response;
}

const ONCHAIN_METADATA = { method: 'onchain', onchainAddress: DEMO_ONCHAIN_ADDRESS };

function onchainObserved(currentConfirmations: number | null): ChainOnchainConfirmationProgress {
  return {
    hasPayment: true,
    hasUnconfirmedPayment: currentConfirmations == null,
    receivedSats: DEMO_AMOUNT,
    currentConfirmations,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    isSatisfied: currentConfirmations != null && currentConfirmations >= REQUIRED_CONFIRMATIONS,
  };
}

export function buildTimelineScenarios(createdAt: number): TimelineScenario[] {
  const base: BaseFields = { createdAt };
  const nowSec = Math.floor(createdAt / 1000);

  return [
    {
      id: 'ln-receive',
      label: 'Lightning · Receive',
      frames: [
        { note: 'Waiting for payment', historyEntry: mintEntry(MintQuoteState.UNPAID, base) },
        { note: 'Payment received', historyEntry: mintEntry(MintQuoteState.PAID, base) },
        { note: 'Funds received', historyEntry: mintEntry(MintQuoteState.ISSUED, base) },
      ],
    },
    {
      id: 'ln-send',
      label: 'Lightning · Send',
      frames: [
        {
          note: 'Ready to send',
          historyEntry: meltEntry(MeltQuoteState.UNPAID, base),
          meltQuote: meltQuote(nowSec + 600),
        },
        { note: 'Processing payment', historyEntry: meltEntry(MeltQuoteState.PENDING, base) },
        { note: 'Sent', historyEntry: meltEntry(MeltQuoteState.PAID, base) },
      ],
    },
    {
      id: 'ln-send-expired',
      label: 'Lightning · Send → expired',
      frames: [
        {
          note: 'Ready to send',
          historyEntry: meltEntry(MeltQuoteState.UNPAID, base),
          meltQuote: meltQuote(nowSec + 600),
        },
        {
          note: 'Quote expired',
          historyEntry: meltEntry(MeltQuoteState.UNPAID, base),
          meltQuote: meltQuote(nowSec - 60),
        },
      ],
    },
    {
      id: 'onchain-receive',
      label: 'Onchain · Receive (mempool)',
      frames: [
        {
          note: 'Waiting for payment',
          historyEntry: mintEntry(MintQuoteState.UNPAID, base, ONCHAIN_METADATA),
          onchainConfirmationProgress:
            buildOnchainRequiredConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
        {
          note: 'Payment detected in mempool',
          historyEntry: mintEntry(MintQuoteState.UNPAID, base, ONCHAIN_METADATA),
          onchainConfirmationProgress: onchainObserved(null),
        },
        // Step one confirmation at a time so each ring segment fills on its own.
        ...Array.from({ length: REQUIRED_CONFIRMATIONS - 1 }, (_, i) => {
          const confirmations = i + 1;
          return {
            note: `${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations`,
            historyEntry: mintEntry(MintQuoteState.UNPAID, base, ONCHAIN_METADATA),
            onchainConfirmationProgress: onchainObserved(confirmations),
          };
        }),
        {
          note: `${REQUIRED_CONFIRMATIONS}/${REQUIRED_CONFIRMATIONS} confirmations`,
          historyEntry: mintEntry(MintQuoteState.PAID, base, ONCHAIN_METADATA),
          onchainConfirmationProgress:
            buildSatisfiedOnchainConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
        {
          note: 'Funds received',
          historyEntry: mintEntry(MintQuoteState.ISSUED, base, ONCHAIN_METADATA),
          onchainConfirmationProgress:
            buildSatisfiedOnchainConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
      ],
    },
    {
      id: 'ecash-send',
      label: 'Ecash · Send',
      frames: [
        { note: 'Preparing token', historyEntry: sendEntry('prepared', base) },
        { note: 'Sending', historyEntry: sendEntry('pending', base) },
        { note: 'Sent', historyEntry: sendEntry('finalized', base) },
      ],
    },
    {
      id: 'ecash-receive',
      label: 'Ecash · Receive',
      frames: [
        { note: 'Receiving token', historyEntry: receiveEntry('prepared', base) },
        { note: 'Redeemed', historyEntry: receiveEntry('finalized', base) },
      ],
    },
    {
      id: 'payment-request',
      label: 'Payment Request (Nostr)',
      frames: [
        {
          note: 'Creating token',
          historyEntry: sendEntry('prepared', base),
          tokenCreated: false,
        },
        {
          note: 'Token created',
          historyEntry: sendEntry('prepared', base),
          tokenCreated: true,
        },
        {
          note: 'Sending via Nostr',
          historyEntry: sendEntry('pending', base),
          tokenCreated: true,
          nostrSent: false,
        },
        {
          note: 'Delivered',
          historyEntry: sendEntry('pending', base),
          tokenCreated: true,
          nostrSent: true,
        },
        {
          note: 'Sent',
          historyEntry: sendEntry('finalized', base),
          tokenCreated: true,
          nostrSent: true,
        },
      ],
    },
    {
      id: 'send-rolled-back',
      label: 'Send → rolled back',
      frames: [
        { note: 'Preparing token', historyEntry: sendEntry('prepared', base) },
        { note: 'Sending', historyEntry: sendEntry('pending', base) },
        { note: 'Returned to balance', historyEntry: sendEntry('rolledBack', base) },
      ],
    },
    {
      id: 'receive-already-spent',
      label: 'Receive → already spent',
      frames: [
        { note: 'Receiving token', historyEntry: receiveEntry('prepared', base) },
        { note: 'Already spent', historyEntry: receiveEntry('rolledBack', base) },
      ],
    },
    {
      id: 'mint-failed',
      label: 'Mint → failed',
      frames: [
        { note: 'Waiting for payment', historyEntry: mintEntry(MintQuoteState.UNPAID, base) },
        { note: 'Mint failed', historyEntry: mintEntry('failed', base) },
      ],
    },
  ];
}
