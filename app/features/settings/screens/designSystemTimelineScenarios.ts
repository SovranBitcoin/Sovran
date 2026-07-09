import { MeltQuoteState, MintQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import {
  normalizeTimelineMeltState,
  normalizeTimelineMintState,
  type ChainOnchainConfirmationProgress,
} from 'wallet';
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

/** Top-level tab on the Design System Timeline screen (payment method). */
export type TimelineScenarioGroup = 'Cashu' | 'Lightning' | 'Onchain' | 'Request';

export interface TimelineScenario {
  id: string;
  label: string;
  /** Which top-level method tab the scenario lives under. */
  group: TimelineScenarioGroup;
  /** Pill sub-tab label within the group (Success / Rollback / …). */
  variant: string;
  frames: TimelineFrame[];
}

/**
 * Debug readout of the coco / cashu-ts state behind a {@link TimelineFrame}.
 *
 * The Timeline copy ("Payment received", "Sending", …) is deliberately friendly, which makes
 * it hard to tell which protocol state a given label maps to. {@link describeFrameState} derives
 * this from the exact same inputs `buildTimeline()` consumes, so the readout can never drift from
 * what the Timeline actually renders.
 */
interface FrameStateInsight {
  /** Where the state lives in the stack, e.g. "cashu-ts · MintQuoteState". */
  source: string;
  /** The precise code-level token a debugger would see, e.g. "MintQuoteState.PAID". */
  code: string;
  /** What that state means at the protocol level. */
  meaning: string;
  /** Secondary signals that refine the step (confirmations, expiry, NUT-18 flags). */
  detail?: { label: string; value: string }[];
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
      id: 'ecash-send',
      label: 'Cashu · Send',
      group: 'Cashu',
      variant: 'Send',
      frames: [
        { note: 'Preparing token', historyEntry: sendEntry('prepared', base) },
        { note: 'Sending', historyEntry: sendEntry('pending', base) },
        { note: 'Sent', historyEntry: sendEntry('finalized', base) },
      ],
    },
    {
      id: 'ecash-receive',
      label: 'Cashu · Receive',
      group: 'Cashu',
      variant: 'Receive',
      frames: [
        { note: 'Receiving token', historyEntry: receiveEntry('prepared', base) },
        { note: 'Redeemed', historyEntry: receiveEntry('finalized', base) },
      ],
    },
    {
      id: 'send-rolled-back',
      label: 'Cashu · Send → rolled back',
      group: 'Cashu',
      variant: 'Rollback',
      frames: [
        { note: 'Preparing token', historyEntry: sendEntry('prepared', base) },
        { note: 'Sending', historyEntry: sendEntry('pending', base) },
        { note: 'Returned to balance', historyEntry: sendEntry('rolledBack', base) },
      ],
    },
    {
      id: 'receive-already-spent',
      label: 'Cashu · Receive → already spent',
      group: 'Cashu',
      variant: 'Already spent',
      frames: [
        { note: 'Receiving token', historyEntry: receiveEntry('prepared', base) },
        { note: 'Already spent', historyEntry: receiveEntry('rolledBack', base) },
      ],
    },
    {
      id: 'ln-receive',
      label: 'Lightning · Receive',
      group: 'Lightning',
      variant: 'Receive',
      frames: [
        { note: 'Waiting for payment', historyEntry: mintEntry(MintQuoteState.UNPAID, base) },
        { note: 'Payment received', historyEntry: mintEntry(MintQuoteState.PAID, base) },
        { note: 'Funds received', historyEntry: mintEntry(MintQuoteState.ISSUED, base) },
      ],
    },
    {
      id: 'ln-send',
      label: 'Lightning · Send',
      group: 'Lightning',
      variant: 'Send',
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
      group: 'Lightning',
      variant: 'Expired',
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
      id: 'mint-failed',
      label: 'Lightning · Mint → failed',
      group: 'Lightning',
      variant: 'Failed',
      frames: [
        { note: 'Waiting for payment', historyEntry: mintEntry(MintQuoteState.UNPAID, base) },
        { note: 'Mint failed', historyEntry: mintEntry('failed', base) },
      ],
    },
    {
      id: 'onchain-receive',
      label: 'Onchain · Receive (mempool)',
      group: 'Onchain',
      variant: 'Receive',
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
      id: 'onchain-send',
      label: 'Onchain · Send (mempool)',
      group: 'Onchain',
      variant: 'Send',
      frames: [
        {
          note: 'Broadcasting…',
          historyEntry: meltEntry('pending', base),
          onchainConfirmationProgress:
            buildOnchainRequiredConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
        {
          note: 'Detected in mempool',
          historyEntry: meltEntry('pending', base),
          onchainConfirmationProgress: onchainObserved(null),
        },
        ...Array.from({ length: REQUIRED_CONFIRMATIONS - 1 }, (_, i) => {
          const confirmations = i + 1;
          return {
            note: `${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations`,
            historyEntry: meltEntry('pending', base),
            onchainConfirmationProgress: onchainObserved(confirmations),
          };
        }),
        {
          note: `${REQUIRED_CONFIRMATIONS}/${REQUIRED_CONFIRMATIONS} confirmations`,
          historyEntry: meltEntry('pending', base),
          onchainConfirmationProgress:
            buildSatisfiedOnchainConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
        {
          note: 'Confirmed',
          historyEntry: meltEntry('PAID', base),
          onchainConfirmationProgress:
            buildSatisfiedOnchainConfirmationProgress(REQUIRED_CONFIRMATIONS),
        },
      ],
    },
    {
      id: 'payment-request',
      label: 'Payment Request (Nostr)',
      group: 'Request',
      variant: 'Nostr send',
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
  ];
}

// ---------------------------------------------------------------------------
// Code-state introspection
// ---------------------------------------------------------------------------

function entryState(entry: HistoryEntry): string {
  return String((entry as unknown as Record<string, unknown>).state ?? '');
}

function isOnchainEntry(entry: HistoryEntry): boolean {
  const metadata = (entry as unknown as Record<string, unknown>).metadata;
  const meta =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : undefined;
  return meta?.method === 'onchain';
}

// The real normalizers from colada's one state owner — the debug readout can
// never drift from what buildTimeline actually renders.
const normalizeMintState = (raw: string): string => normalizeTimelineMintState(raw);
const normalizeMeltState = (raw: string): string => normalizeTimelineMeltState(raw);

const BOLT11_MINT_MEANING: Record<string, string> = {
  [MintQuoteState.UNPAID]: 'Mint quote issued — the Lightning invoice has not been paid yet.',
  [MintQuoteState.PAID]: 'Invoice paid at the mint — proofs not yet minted into the wallet.',
  [MintQuoteState.ISSUED]: 'Proofs minted and stored — the receive is complete.',
};

const ONCHAIN_MINT_MEANING: Record<string, string> = {
  [MintQuoteState.UNPAID]: 'Deposit address issued — watching the chain for an incoming tx.',
  [MintQuoteState.PAID]: 'Required confirmations reached — the mint will issue ecash.',
  [MintQuoteState.ISSUED]: 'Proofs minted and stored — the receive is complete.',
};

const MELT_MEANING: Record<string, string> = {
  [MeltQuoteState.UNPAID]: 'Melt quote accepted — the wallet has not started paying yet.',
  [MeltQuoteState.PENDING]: 'Mint is paying the Lightning invoice — settlement in flight.',
  [MeltQuoteState.PAID]: 'Lightning invoice settled — the send is complete.',
};

const SEND_MEANING: Record<string, string> = {
  prepared: 'Token built and reserved from your balance — not yet claimed by anyone.',
  pending: 'Token is outstanding — waiting for the recipient to claim it.',
  finalized: 'Recipient claimed the token — the proofs are now spent.',
  rolledBack: 'Send reversed — the reserved proofs returned to your balance.',
};

const RECEIVE_MEANING: Record<string, string> = {
  prepared: 'Incoming token parsed — the swap with the mint is not finalized yet.',
  finalized: 'Proofs swapped into your wallet — the receive is complete.',
  rolledBack: 'Swap rejected — these proofs were already spent at the mint.',
};

function onchainDetail(p: ChainOnchainConfirmationProgress): { label: string; value: string }[] {
  const mempool = !p.hasPayment
    ? 'no tx seen yet'
    : p.hasUnconfirmedPayment && p.currentConfirmations == null
      ? 'tx in mempool · 0 conf'
      : 'tx mined';
  return [
    { label: 'mempool', value: mempool },
    {
      label: 'confirmations',
      value: `${p.currentConfirmations ?? 0} / ${p.requiredConfirmations}`,
    },
    { label: 'isSatisfied', value: p.isSatisfied ? 'true → minting ecash' : 'false' },
  ];
}

function meltQuoteExpired(quote: MeltQuoteBolt11Response): boolean {
  if (!quote.expiry) return false;
  return Math.floor(Date.now() / 1000) > quote.expiry;
}

/**
 * Resolve the coco / cashu-ts state a given Timeline frame represents, for the Design System
 * debug readout. Derived from the frame's own inputs — the same data `buildTimeline()` reads.
 */
export function describeFrameState(frame: TimelineFrame): FrameStateInsight {
  const entry = frame.historyEntry;
  const raw = entryState(entry);

  switch (entry.type) {
    case 'mint': {
      if (normalizeMintState(raw) === 'failed') {
        return {
          source: 'coco · mint operation',
          code: 'op.state = "failed"',
          meaning: 'Mint operation failed — the quote never completed and no ecash was issued.',
        };
      }
      const onchain = isOnchainEntry(entry);
      const state = normalizeMintState(raw);
      const progress = frame.onchainConfirmationProgress;
      return {
        source: onchain
          ? 'cashu-ts · MintQuoteState (onchain mint)'
          : 'cashu-ts · MintQuoteState (bolt11 mint)',
        code: `MintQuoteState.${state}`,
        meaning: (onchain ? ONCHAIN_MINT_MEANING : BOLT11_MINT_MEANING)[state] ?? '',
        detail: onchain && progress ? onchainDetail(progress) : undefined,
      };
    }

    case 'melt': {
      const state = normalizeMeltState(raw);
      const expired = frame.meltQuote ? meltQuoteExpired(frame.meltQuote) : false;
      return {
        source: 'cashu-ts · MeltQuoteState',
        code: `MeltQuoteState.${state}`,
        meaning: expired
          ? 'Quote expiry timestamp passed — still UNPAID at the mint, surfaced to the user as expired.'
          : (MELT_MEANING[state] ?? ''),
        detail: frame.meltQuote
          ? [{ label: 'quote expiry', value: expired ? 'elapsed → expired' : 'valid' }]
          : undefined,
      };
    }

    case 'send': {
      const isPaymentRequest = frame.tokenCreated !== undefined || !!frame.nostrSent;
      if (isPaymentRequest) {
        let meaning = SEND_MEANING[raw] ?? '';
        if (raw === 'prepared') {
          meaning = frame.tokenCreated
            ? 'Token built — not yet published to Nostr.'
            : 'Building the cashu token to enclose in the request.';
        } else if (raw === 'pending') {
          meaning = frame.nostrSent
            ? 'DM accepted by the relays — waiting for the recipient to claim.'
            : 'Publishing the encrypted DM (the token) to the relays.';
        }
        return {
          source: 'coco · send operation + NUT-18',
          code: `op.state = "${raw}"`,
          meaning,
          detail: [
            { label: 'tokenCreated', value: String(!!frame.tokenCreated) },
            { label: 'nostrSent', value: String(!!frame.nostrSent) },
          ],
        };
      }
      return {
        source: 'coco · send operation',
        code: `op.state = "${raw}"`,
        meaning: SEND_MEANING[raw] ?? '',
      };
    }

    case 'receive':
      return {
        source: 'coco · receive operation',
        code: `op.state = "${raw}"`,
        meaning: RECEIVE_MEANING[raw] ?? '',
      };

    default:
      return { source: 'unknown', code: raw, meaning: '' };
  }
}
