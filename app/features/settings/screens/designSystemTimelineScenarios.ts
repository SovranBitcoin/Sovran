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
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';

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
// BOLT11 spec test vector, created in 2017 with a one-hour expiry: a real
// invoice that is long expired, for the "expired before payment" path.
const EXPIRED_INVOICE =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
const DEMO_RECIPIENT_KEY = `02${'ab'.repeat(32)}`;

interface TimelineFrame {
  /** Short caption describing the simulated step, shown under the preview. */
  note: string;
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  onchainConfirmationProgress?: ChainOnchainConfirmationProgress | null;
  /** Off-chain (internal) settlement verdict for onchain sends. */
  onchainSettledInternally?: boolean;
  /** The user tapped Cancel and the wallet has not answered yet. */
  cancelling?: boolean;
}

/** Top-level tab on the Design System Timeline screen (what kind of payment). */
export type TimelineScenarioGroup = 'Cashu' | 'Locked' | 'Lightning' | 'Onchain' | 'Request';

interface TimelineScenario {
  id: string;
  label: string;
  /** Which top-level type tab the scenario lives under. */
  group: TimelineScenarioGroup;
  /** Pill sub-tab label within the group: one path through that flow. */
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

/** One entry, followed through its states. The id is fixed per scenario: a
 *  timeline remembers the rows it has drawn per entry, exactly as it does for
 *  a real payment, so the frames of one path have to be one entry. */
interface EntrySeed {
  id: string;
  createdAt: number;
}

type EntryExtra = Record<string, unknown>;

/** A state that ended the flow carries the moment it ended. */
function ended(state: string, { createdAt }: EntrySeed): { updatedAt: number } {
  const terminal = /^(ISSUED|PAID|finalized|failed|rolledBack|rolled_back)$/.test(state);
  return { updatedAt: terminal ? createdAt + 90_000 : createdAt };
}

function mintEntry(state: string, seed: EntrySeed, extra: EntryExtra = {}): HistoryEntry {
  return asHistoryEntry({
    id: seed.id,
    source: 'legacy',
    legacyHistoryId: seed.id,
    type: 'mint',
    createdAt: seed.createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    quoteId: 'ds-mint-quote',
    paymentRequest: '',
    state,
    ...ended(state, seed),
    ...extra,
  });
}

function meltEntry(state: string, seed: EntrySeed, extra: EntryExtra = {}): HistoryEntry {
  return asHistoryEntry({
    id: seed.id,
    source: 'legacy',
    legacyHistoryId: seed.id,
    type: 'melt',
    createdAt: seed.createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    quoteId: 'ds-melt-quote',
    state,
    ...ended(state, seed),
    ...extra,
  });
}

function sendEntry(state: string, seed: EntrySeed, extra: EntryExtra = {}): HistoryEntry {
  return asHistoryEntry({
    id: seed.id,
    source: 'legacy',
    legacyHistoryId: seed.id,
    type: 'send',
    createdAt: seed.createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    operationId: 'ds-send-op',
    state,
    ...ended(state, seed),
    ...extra,
  });
}

function receiveEntry(state: string, seed: EntrySeed, extra: EntryExtra = {}): HistoryEntry {
  return asHistoryEntry({
    id: seed.id,
    source: 'legacy',
    legacyHistoryId: seed.id,
    type: 'receive',
    createdAt: seed.createdAt,
    mintUrl: DEMO_MINT_URL,
    unit: DEMO_UNIT,
    amount: DEMO_AMOUNT,
    operationId: 'ds-receive-op',
    state,
    ...ended(state, seed),
    ...extra,
  });
}

function meltQuote(expirySeconds: number): MeltQuoteBolt11Response {
  // Dev-only demo stub; fabricating the full cashu-ts quote would assert
  // fields the Timeline never reads.
  // ast-grep-ignore: double-assertion-ts
  return { expiry: expirySeconds } as unknown as MeltQuoteBolt11Response;
}

const ONCHAIN = { metadata: { method: 'onchain', onchainAddress: DEMO_ONCHAIN_ADDRESS } };
/** A token that exists: coco attaches it from `pending` on. */
const PLAIN_TOKEN = { token: { proofs: [{ secret: 'ds-plain-secret' }] } };

/** A token locked to the demo recipient, optionally until `locktimeMs`, with
 *  the refund path the tags describe. */
function lockedToken(tags: string[][]): EntryExtra {
  return {
    token: {
      proofs: [
        {
          secret: JSON.stringify([
            'P2PK',
            { nonce: 'cd'.repeat(16), data: DEMO_RECIPIENT_KEY, tags },
          ]),
        },
      ],
    },
  };
}

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

/** One frame per block, so each ring segment fills on its own. */
function confirmationFrames(entry: HistoryEntry, from = 1): TimelineFrame[] {
  return Array.from({ length: REQUIRED_CONFIRMATIONS - from }, (_, i) => {
    const confirmations = from + i;
    return {
      note: `${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations`,
      historyEntry: entry,
      onchainConfirmationProgress: onchainObserved(confirmations),
    };
  });
}

/**
 * Every path a payment can take, grouped by what kind of payment it is.
 *
 * This is the visual half of the wallet's brute-force walk
 * (`wallet/__tests__/unit/timeline-bruteforce.test.ts`): that test proves no
 * transition removes a row; these are the paths worth watching animate.
 */
export function buildTimelineScenarios(createdAt: number): TimelineScenario[] {
  const nowSec = Math.floor(createdAt / 1000);
  const seed = (id: string): EntrySeed => ({ id: `ds-${id}`, createdAt });
  const NO_DEPOSIT = buildOnchainRequiredConfirmationProgress(REQUIRED_CONFIRMATIONS);
  const DEEP_ENOUGH = buildSatisfiedOnchainConfirmationProgress(REQUIRED_CONFIRMATIONS);

  // Timed locks. "Before" unlocks a day out; "after" is the same lock an hour
  // past its date — the frame change stands in for the clock running.
  const lockedUntil = (offsetSec: number, refund: boolean) =>
    lockedToken([
      ['locktime', String(nowSec + offsetSec)],
      ...(refund ? [['refund', DEMO_RECIPIENT_KEY]] : []),
    ]);
  const STILL_LOCKED = 86_400;
  const NOW_OPEN = -3_600;

  const cashu = (): TimelineScenario[] => {
    const send = seed('send');
    const cancelEarly = seed('send-cancel-early');
    const reclaim = seed('send-reclaim');
    const cancelFails = seed('send-cancel-fails');
    const receive = seed('receive');
    const offline = seed('receive-offline');
    const spent = seed('receive-spent');
    const rejected = seed('receive-rejected');
    return [
      {
        id: 'ecash-send',
        label: 'Cashu · Send',
        group: 'Cashu',
        variant: 'Send',
        frames: [
          { note: 'Reserving ecash', historyEntry: sendEntry('prepared', send) },
          { note: 'Swapping at the mint', historyEntry: sendEntry('executing', send) },
          { note: 'Token out, unclaimed', historyEntry: sendEntry('pending', send, PLAIN_TOKEN) },
          { note: 'Recipient claimed it', historyEntry: sendEntry('finalized', send, PLAIN_TOKEN) },
        ],
      },
      {
        id: 'send-cancelled-early',
        label: 'Cashu · Send → cancelled before a token existed',
        group: 'Cashu',
        variant: 'Cancel early',
        frames: [
          { note: 'Reserving ecash', historyEntry: sendEntry('prepared', cancelEarly) },
          { note: 'Cancelled', historyEntry: sendEntry('rolled_back', cancelEarly) },
        ],
      },
      {
        id: 'send-rolled-back',
        label: 'Cashu · Send → reclaimed',
        group: 'Cashu',
        variant: 'Reclaim',
        frames: [
          { note: 'Reserving ecash', historyEntry: sendEntry('prepared', reclaim) },
          {
            note: 'Token out, unclaimed',
            historyEntry: sendEntry('pending', reclaim, PLAIN_TOKEN),
          },
          {
            note: 'Cancel tapped',
            historyEntry: sendEntry('pending', reclaim, PLAIN_TOKEN),
            cancelling: true,
          },
          {
            note: 'Reclaim swap in flight',
            historyEntry: sendEntry('rolling_back', reclaim, PLAIN_TOKEN),
          },
          {
            note: 'Returned to balance',
            historyEntry: sendEntry('rolled_back', reclaim, PLAIN_TOKEN),
          },
        ],
      },
      {
        // The recipient redeemed first: the reclaim fails and the send
        // settles as claimed after all.
        id: 'send-cancel-lost-race',
        label: 'Cashu · Send → cancel loses the race',
        group: 'Cashu',
        variant: 'Cancel too late',
        frames: [
          {
            note: 'Token out, unclaimed',
            historyEntry: sendEntry('pending', cancelFails, PLAIN_TOKEN),
          },
          {
            note: 'Cancel tapped',
            historyEntry: sendEntry('pending', cancelFails, PLAIN_TOKEN),
            cancelling: true,
          },
          {
            note: 'Cancel failed, still out',
            historyEntry: sendEntry('pending', cancelFails, PLAIN_TOKEN),
          },
          {
            note: 'Recipient had claimed it',
            historyEntry: sendEntry('finalized', cancelFails, PLAIN_TOKEN),
          },
        ],
      },
      {
        id: 'ecash-receive',
        label: 'Cashu · Receive',
        group: 'Cashu',
        variant: 'Receive',
        frames: [
          { note: 'Token read, not redeemed', historyEntry: receiveEntry('prepared', receive) },
          { note: 'Redeemed', historyEntry: receiveEntry('finalized', receive) },
        ],
      },
      {
        id: 'receive-offline',
        label: 'Cashu · Receive → mint unreachable, then back',
        group: 'Cashu',
        variant: 'Receive offline',
        frames: [
          { note: 'Token read, not redeemed', historyEntry: receiveEntry('prepared', offline) },
          { note: 'Mint unreachable', historyEntry: receiveEntry('executing', offline) },
          { note: 'Redeemed once online', historyEntry: receiveEntry('finalized', offline) },
        ],
      },
      {
        id: 'receive-already-spent',
        label: 'Cashu · Receive → already spent',
        group: 'Cashu',
        variant: 'Already spent',
        frames: [
          { note: 'Token read, not redeemed', historyEntry: receiveEntry('prepared', spent) },
          {
            note: 'Mint says spent (11001)',
            historyEntry: receiveEntry('rolledBack', spent, { error: 'Token already spent' }),
          },
        ],
      },
      {
        // Any other rejection (inactive keyset, failed witness, unsigned
        // outputs): the mint did not say who spent what, so neither do we.
        id: 'receive-not-added',
        label: 'Cashu · Receive → not added',
        group: 'Cashu',
        variant: 'Not added',
        frames: [
          { note: 'Token read, not redeemed', historyEntry: receiveEntry('prepared', rejected) },
          {
            note: 'Mint rejected the swap',
            historyEntry: receiveEntry('rolledBack', rejected, {
              error: 'Keyset is inactive (12002)',
            }),
          },
        ],
      },
    ];
  };

  const locked = (): TimelineScenario[] => {
    const permanent = seed('locked-permanent');
    const early = seed('locked-claimed-early');
    const late = seed('locked-claimed-late');
    const reclaimed = seed('locked-reclaimed');
    const open = seed('locked-open');
    return [
      {
        id: 'locked-permanent',
        label: 'Locked · no unlock date',
        group: 'Locked',
        variant: 'Permanent',
        frames: [
          { note: 'Reserving ecash', historyEntry: sendEntry('prepared', permanent) },
          {
            note: 'Locked to the recipient',
            historyEntry: sendEntry('pending', permanent, lockedToken([])),
          },
          {
            note: 'Recipient claimed it',
            historyEntry: sendEntry('finalized', permanent, lockedToken([])),
          },
        ],
      },
      {
        id: 'locked-claimed-early',
        label: 'Locked · claimed before it unlocks',
        group: 'Locked',
        variant: 'Claimed early',
        frames: [
          {
            note: 'Locked until a date',
            historyEntry: sendEntry('pending', early, lockedUntil(STILL_LOCKED, true)),
          },
          {
            note: 'Claimed before the date',
            historyEntry: sendEntry('finalized', early, lockedUntil(STILL_LOCKED, true)),
          },
        ],
      },
      {
        id: 'locked-claimed-late',
        label: 'Locked · unlocks, then claimed',
        group: 'Locked',
        variant: 'Claimed late',
        frames: [
          {
            note: 'Locked until a date',
            historyEntry: sendEntry('pending', late, lockedUntil(STILL_LOCKED, true)),
          },
          {
            note: 'The date passes',
            historyEntry: sendEntry('pending', late, lockedUntil(NOW_OPEN, true)),
          },
          {
            note: 'Claimed after the date',
            historyEntry: sendEntry('finalized', late, lockedUntil(NOW_OPEN, true)),
          },
        ],
      },
      {
        id: 'locked-reclaimed',
        label: 'Locked · unlocks, then taken back',
        group: 'Locked',
        variant: 'Reclaimed',
        frames: [
          {
            note: 'Locked until a date',
            historyEntry: sendEntry('pending', reclaimed, lockedUntil(STILL_LOCKED, true)),
          },
          {
            note: 'The date passes',
            historyEntry: sendEntry('pending', reclaimed, lockedUntil(NOW_OPEN, true)),
          },
          {
            note: 'Refund in flight',
            historyEntry: sendEntry('rolling_back', reclaimed, lockedUntil(NOW_OPEN, true)),
          },
          {
            note: 'Taken back',
            historyEntry: sendEntry('rolled_back', reclaimed, lockedUntil(NOW_OPEN, true)),
          },
        ],
      },
      {
        // No refund tag: past the date the token needs no signature at all.
        id: 'locked-open-to-anyone',
        label: 'Locked · unlocks to whoever holds it',
        group: 'Locked',
        variant: 'Opens to anyone',
        frames: [
          {
            note: 'Locked until a date',
            historyEntry: sendEntry('pending', open, lockedUntil(STILL_LOCKED, false)),
          },
          {
            note: 'The date passes',
            historyEntry: sendEntry('pending', open, lockedUntil(NOW_OPEN, false)),
          },
        ],
      },
    ];
  };

  const lightning = (): TimelineScenario[] => {
    const receive = seed('ln-receive');
    const expired = seed('ln-receive-expired');
    const failed = seed('ln-receive-failed');
    const failedPaid = seed('ln-receive-failed-paid');
    const retried = seed('ln-receive-retried');
    const send = seed('ln-send');
    const instant = seed('ln-send-instant');
    const sendExpired = seed('ln-send-expired');
    const sendFailed = seed('ln-send-failed');
    const sendCancelled = seed('ln-send-cancelled');
    return [
      {
        id: 'ln-receive',
        label: 'Lightning · Receive',
        group: 'Lightning',
        variant: 'Receive',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry(MintQuoteState.UNPAID, receive) },
          { note: 'Mint saw the payment', historyEntry: mintEntry(MintQuoteState.PAID, receive) },
          { note: 'Ecash minted', historyEntry: mintEntry(MintQuoteState.ISSUED, receive) },
        ],
      },
      {
        id: 'ln-receive-expired',
        label: 'Lightning · Receive → invoice expired',
        group: 'Lightning',
        variant: 'Receive expired',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry(MintQuoteState.UNPAID, expired) },
          {
            note: 'Invoice past its expiry',
            historyEntry: mintEntry(MintQuoteState.UNPAID, expired, {
              paymentRequest: EXPIRED_INVOICE,
            }),
          },
        ],
      },
      {
        id: 'mint-failed',
        label: 'Lightning · Receive → failed before payment',
        group: 'Lightning',
        variant: 'Receive failed',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry(MintQuoteState.UNPAID, failed) },
          { note: 'Quote rejected', historyEntry: mintEntry('failed', failed) },
        ],
      },
      {
        // The one failure where money moved: the payer paid, the mint would
        // not issue (e.g. nutshell refusing a paid-but-expired quote, 20007).
        id: 'mint-failed-after-payment',
        label: 'Lightning · Receive → paid, then failed',
        group: 'Lightning',
        variant: 'Paid, then failed',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry(MintQuoteState.UNPAID, failedPaid) },
          {
            note: 'Mint saw the payment',
            historyEntry: mintEntry(MintQuoteState.PAID, failedPaid),
          },
          {
            note: 'Mint refused to issue',
            historyEntry: mintEntry('failed', failedPaid, { remoteState: MintQuoteState.PAID }),
          },
        ],
      },
      {
        // The mint already issued this quote and the outputs cannot be
        // restored: coco finishes the operation with a reason and no ecash.
        id: 'mint-unrestored',
        label: 'Lightning · Receive → issued, nothing restored',
        group: 'Lightning',
        variant: 'Issued, not restored',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry('pending', seed('ln-unrestored')) },
          {
            note: 'Mint says ISSUED, wallet has nothing',
            historyEntry: mintEntry('pending', seed('ln-unrestored'), {
              remoteState: MintQuoteState.ISSUED,
            }),
          },
          {
            note: 'Finished without the ecash',
            historyEntry: mintEntry('finalized', seed('ln-unrestored'), {
              error: 'Recovered issued quote but no proofs could be restored',
            }),
          },
        ],
      },
      {
        // coco steps the operation back to `pending` when a claim attempt
        // fails on the network, then tries again.
        id: 'mint-retried',
        label: 'Lightning · Receive → claim retried',
        group: 'Lightning',
        variant: 'Claim retried',
        frames: [
          { note: 'Invoice unpaid', historyEntry: mintEntry('pending', retried) },
          { note: 'Claiming', historyEntry: mintEntry('executing', retried) },
          { note: 'Claim failed, stepped back', historyEntry: mintEntry('pending', retried) },
          { note: 'Claiming again', historyEntry: mintEntry('executing', retried) },
          { note: 'Ecash minted', historyEntry: mintEntry('finalized', retried) },
        ],
      },
      {
        id: 'ln-send',
        label: 'Lightning · Send',
        group: 'Lightning',
        variant: 'Send',
        frames: [
          {
            note: 'Quote ready',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, send),
            meltQuote: meltQuote(nowSec + 600),
          },
          { note: 'Mint is paying', historyEntry: meltEntry(MeltQuoteState.PENDING, send) },
          { note: 'Invoice settled', historyEntry: meltEntry(MeltQuoteState.PAID, send) },
        ],
      },
      {
        // The mint answers PAID on the same request, so `pending` never shows.
        id: 'ln-send-instant',
        label: 'Lightning · Send → settles in one step',
        group: 'Lightning',
        variant: 'Send instant',
        frames: [
          {
            note: 'Quote ready',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, instant),
            meltQuote: meltQuote(nowSec + 600),
          },
          { note: 'Settled at once', historyEntry: meltEntry(MeltQuoteState.PAID, instant) },
        ],
      },
      {
        id: 'ln-send-expired',
        label: 'Lightning · Send → quote expired',
        group: 'Lightning',
        variant: 'Send expired',
        frames: [
          {
            note: 'Quote ready',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, sendExpired),
            meltQuote: meltQuote(nowSec + 600),
          },
          {
            note: 'Quote past its expiry',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, sendExpired),
            meltQuote: meltQuote(nowSec - 60),
          },
        ],
      },
      {
        id: 'ln-send-failed',
        label: 'Lightning · Send → payment failed',
        group: 'Lightning',
        variant: 'Send failed',
        frames: [
          {
            note: 'Quote ready',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, sendFailed),
            meltQuote: meltQuote(nowSec + 600),
          },
          { note: 'Mint is paying', historyEntry: meltEntry(MeltQuoteState.PENDING, sendFailed) },
          { note: 'Restoring ecash', historyEntry: meltEntry('rolling_back', sendFailed) },
          {
            note: 'Payment failed (20004)',
            historyEntry: meltEntry('rolled_back', sendFailed, {
              error: 'Recovered: Lightning payment failed',
            }),
          },
        ],
      },
      {
        // A stuck HTLC: the mint keeps saying PENDING. The ecash is neither
        // spent nor free until it resolves.
        id: 'ln-send-slow',
        label: 'Lightning · Send → stuck in flight',
        group: 'Lightning',
        variant: 'Send slow',
        frames: [
          {
            note: 'Mint is paying',
            historyEntry: meltEntry(MeltQuoteState.PENDING, seed('ln-slow')),
          },
          {
            note: 'Still PENDING ten minutes on',
            historyEntry: meltEntry(MeltQuoteState.PENDING, {
              id: 'ds-ln-slow',
              createdAt: createdAt - 10 * 60_000,
            }),
          },
        ],
      },
      {
        id: 'ln-send-cancelled',
        label: 'Lightning · Send → cancelled before paying',
        group: 'Lightning',
        variant: 'Send cancelled',
        frames: [
          {
            note: 'Quote ready',
            historyEntry: meltEntry(MeltQuoteState.UNPAID, sendCancelled),
            meltQuote: meltQuote(nowSec + 600),
          },
          { note: 'Backed out', historyEntry: meltEntry('rolled_back', sendCancelled) },
        ],
      },
    ];
  };

  const onchain = (): TimelineScenario[] => {
    const receive = seed('onchain-receive');
    const dropped = seed('onchain-receive-dropped');
    const mintFirst = seed('onchain-receive-mint-first');
    const failed = seed('onchain-receive-failed');
    const send = seed('onchain-send');
    const offchain = seed('onchain-send-offchain');
    const sendDropped = seed('onchain-send-dropped');
    const sendFailed = seed('onchain-send-failed');
    const unpaid = (s: EntrySeed) => mintEntry(MintQuoteState.UNPAID, s, ONCHAIN);
    const melting = (s: EntrySeed) => meltEntry('pending', s, ONCHAIN);
    const submit = (s: EntrySeed): TimelineFrame[] => [
      {
        note: 'Submitting to mint',
        historyEntry: meltEntry(MeltQuoteState.UNPAID, s, ONCHAIN),
        onchainConfirmationProgress: NO_DEPOSIT,
      },
      {
        note: 'Accepted, not broadcast (no outpoint)',
        historyEntry: melting(s),
        onchainConfirmationProgress: NO_DEPOSIT,
      },
    ];
    return [
      {
        id: 'onchain-receive',
        label: 'Onchain · Receive',
        group: 'Onchain',
        variant: 'Receive',
        frames: [
          {
            note: 'Address unfunded',
            historyEntry: unpaid(receive),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
          {
            note: 'Deposit in mempool',
            historyEntry: unpaid(receive),
            onchainConfirmationProgress: onchainObserved(null),
          },
          ...confirmationFrames(unpaid(receive)),
          {
            note: 'Deep enough, mint has not credited',
            historyEntry: unpaid(receive),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
          {
            note: 'Mint credited the quote',
            historyEntry: mintEntry(MintQuoteState.PAID, receive, ONCHAIN),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
          {
            note: 'Ecash minted',
            historyEntry: mintEntry(MintQuoteState.ISSUED, receive, ONCHAIN),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
        ],
      },
      {
        // Replaced, evicted, or reorganised out: the explorer stops reporting
        // a transaction it had shown. It may come back.
        id: 'onchain-receive-dropped',
        label: 'Onchain · Receive → deposit leaves the mempool',
        group: 'Onchain',
        variant: 'Receive dropped',
        frames: [
          {
            note: 'Address unfunded',
            historyEntry: unpaid(dropped),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
          {
            note: 'Deposit in mempool',
            historyEntry: unpaid(dropped),
            onchainConfirmationProgress: onchainObserved(null),
          },
          {
            note: 'Explorer no longer sees it',
            historyEntry: unpaid(dropped),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
          {
            note: 'Seen again (rebroadcast)',
            historyEntry: unpaid(dropped),
            onchainConfirmationProgress: onchainObserved(null),
          },
          ...confirmationFrames(unpaid(dropped), 1).slice(0, 2),
        ],
      },
      {
        // The mint decides when a deposit is credited, from its own node. Our
        // explorer is only a hint, and this is what it looks like when the
        // hint runs far ahead: a deposit below the mint's minimum, or one it
        // first saw after the request expired, is never credited (NUT-30).
        id: 'onchain-receive-never-credited',
        label: 'Onchain · Receive → confirmed, mint never credits',
        group: 'Onchain',
        variant: 'Receive, not credited',
        frames: [
          {
            note: 'Deposit in mempool',
            historyEntry: unpaid(seed('onchain-never-credited')),
            onchainConfirmationProgress: onchainObserved(null),
          },
          {
            note: 'Our explorer: 6 of 6, mint silent',
            historyEntry: unpaid(seed('onchain-never-credited')),
            onchainConfirmationProgress: {
              ...DEEP_ENOUGH,
              observedConfirmations: 6,
              requirementFromMint: true,
            },
          },
          {
            note: 'Our explorer: 7 deep (could still be lag)',
            historyEntry: unpaid(seed('onchain-never-credited')),
            onchainConfirmationProgress: {
              ...DEEP_ENOUGH,
              observedConfirmations: 7,
              requirementFromMint: true,
            },
          },
          {
            note: 'Our explorer: 12 deep, still no credit',
            historyEntry: unpaid(seed('onchain-never-credited')),
            onchainConfirmationProgress: {
              ...DEEP_ENOUGH,
              observedConfirmations: 12,
              requirementFromMint: true,
            },
          },
        ],
      },
      {
        // The mint credits before our explorer has reported anything.
        id: 'onchain-receive-mint-first',
        label: 'Onchain · Receive → mint credits first',
        group: 'Onchain',
        variant: 'Receive, no explorer',
        frames: [
          { note: 'Address unfunded', historyEntry: unpaid(mintFirst) },
          {
            note: 'Mint credited, explorer silent',
            historyEntry: mintEntry(MintQuoteState.PAID, mintFirst, ONCHAIN),
          },
          {
            note: 'Ecash minted',
            historyEntry: mintEntry(MintQuoteState.ISSUED, mintFirst, ONCHAIN),
          },
        ],
      },
      {
        id: 'onchain-receive-failed',
        label: 'Onchain · Receive → confirmed, then failed',
        group: 'Onchain',
        variant: 'Receive failed',
        frames: [
          {
            note: 'Deposit in mempool',
            historyEntry: unpaid(failed),
            onchainConfirmationProgress: onchainObserved(null),
          },
          {
            note: 'Deep enough',
            historyEntry: unpaid(failed),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
          {
            note: 'Mint refused to issue',
            historyEntry: mintEntry('failed', failed, {
              ...ONCHAIN,
              remoteState: MintQuoteState.PAID,
            }),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
        ],
      },
      {
        id: 'onchain-send',
        label: 'Onchain · Send',
        group: 'Onchain',
        variant: 'Send',
        frames: [
          ...submit(send),
          {
            note: 'Broadcast (outpoint set)',
            historyEntry: melting(send),
            onchainConfirmationProgress: onchainObserved(null),
          },
          ...confirmationFrames(melting(send)),
          {
            note: 'Deep enough by our count',
            historyEntry: melting(send),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
          {
            note: 'Mint reports PAID',
            historyEntry: meltEntry('PAID', send, ONCHAIN),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
        ],
      },
      {
        // The mint and our explorer are separate observers. Here the mint
        // reaches its depth while our count is still behind.
        id: 'onchain-send-mint-first',
        label: 'Onchain · Send → mint confirms before our explorer',
        group: 'Onchain',
        variant: 'Send, mint first',
        frames: [
          ...submit(seed('onchain-send-mint-first')),
          {
            note: 'Broadcast (outpoint set)',
            historyEntry: melting(seed('onchain-send-mint-first')),
            onchainConfirmationProgress: onchainObserved(null),
          },
          {
            note: 'Our explorer: 3 of 6',
            historyEntry: melting(seed('onchain-send-mint-first')),
            onchainConfirmationProgress: onchainObserved(3),
          },
          {
            note: 'Mint reports PAID at our 3 of 6',
            historyEntry: meltEntry('PAID', seed('onchain-send-mint-first'), ONCHAIN),
            onchainConfirmationProgress: onchainObserved(3),
          },
        ],
      },
      {
        // And the other way round: our explorer counts the last block while
        // the mint still says PENDING.
        id: 'onchain-send-explorer-first',
        label: 'Onchain · Send → our explorer confirms before the mint',
        group: 'Onchain',
        variant: 'Send, explorer first',
        frames: [
          ...submit(seed('onchain-send-explorer-first')),
          {
            note: 'Our explorer: 3 of 6',
            historyEntry: melting(seed('onchain-send-explorer-first')),
            onchainConfirmationProgress: onchainObserved(3),
          },
          {
            note: 'Our explorer: deep enough, mint PENDING',
            historyEntry: melting(seed('onchain-send-explorer-first')),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
          {
            note: 'Mint catches up',
            historyEntry: meltEntry('PAID', seed('onchain-send-explorer-first'), ONCHAIN),
            onchainConfirmationProgress: DEEP_ENOUGH,
          },
        ],
      },
      {
        id: 'onchain-send-offchain',
        label: 'Onchain · Send → settled off-chain',
        group: 'Onchain',
        variant: 'Send off-chain',
        frames: [
          ...submit(offchain),
          {
            note: 'PAID with no outpoint',
            historyEntry: meltEntry('PAID', offchain, ONCHAIN),
            onchainConfirmationProgress: NO_DEPOSIT,
            onchainSettledInternally: true,
          },
        ],
      },
      {
        id: 'onchain-send-dropped',
        label: 'Onchain · Send → transaction leaves the mempool',
        group: 'Onchain',
        variant: 'Send dropped',
        frames: [
          ...submit(sendDropped),
          {
            note: 'Broadcast (outpoint set)',
            historyEntry: melting(sendDropped),
            onchainConfirmationProgress: onchainObserved(null),
          },
          {
            note: 'Explorer no longer sees it',
            historyEntry: melting(sendDropped),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
          {
            note: 'Seen again',
            historyEntry: melting(sendDropped),
            onchainConfirmationProgress: onchainObserved(1),
          },
        ],
      },
      {
        // The mint's batch never committed a signed transaction: the intent
        // fails and the quote falls back to UNPAID.
        id: 'onchain-send-failed',
        label: 'Onchain · Send → mint could not broadcast',
        group: 'Onchain',
        variant: 'Send failed',
        frames: [
          ...submit(sendFailed),
          {
            note: 'Restoring ecash',
            historyEntry: meltEntry('rolling_back', sendFailed, ONCHAIN),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
          {
            note: 'Funds returned',
            historyEntry: meltEntry('rolled_back', sendFailed, {
              ...ONCHAIN,
              error: 'Recovered: quote returned to UNPAID',
            }),
            onchainConfirmationProgress: NO_DEPOSIT,
          },
        ],
      },
    ];
  };

  const request = (): TimelineScenario[] => {
    const pay = seed('pr-pay');
    const payCancelled = seed('pr-pay-cancelled');
    const payUndelivered = seed('pr-pay-undelivered');
    const receive = seed('pr-receive');
    const receiveSpent = seed('pr-receive-spent');
    const awaiting = (s: EntrySeed) =>
      receiveEntry('executing', s, { metadata: { paymentRequestPending: '1' } });
    const claiming = (state: string, s: EntrySeed, extra: EntryExtra = {}) =>
      receiveEntry(state, s, { metadata: { source: 'payment-request' }, ...extra });
    return [
      {
        id: 'payment-request',
        label: 'Request · Pay over Nostr',
        group: 'Request',
        variant: 'Pay',
        frames: [
          {
            note: 'Building the token',
            historyEntry: sendEntry('prepared', pay),
            tokenCreated: false,
          },
          { note: 'Token built', historyEntry: sendEntry('prepared', pay), tokenCreated: true },
          {
            note: 'Publishing to relays',
            historyEntry: sendEntry('pending', pay, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: false,
          },
          {
            note: 'Relays accepted it',
            historyEntry: sendEntry('pending', pay, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: true,
          },
          {
            note: 'Recipient claimed it',
            historyEntry: sendEntry('finalized', pay, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: true,
          },
        ],
      },
      {
        // A request with an HTTP transport, reopened from history: no live
        // flags, only the record written when it was handed over.
        id: 'payment-request-http',
        label: 'Request · Pay over HTTP (reopened from history)',
        group: 'Request',
        variant: 'Pay, HTTP',
        frames: [
          {
            note: 'Posted to the server, unclaimed',
            historyEntry: sendEntry('pending', seed('pr-pay-http'), {
              ...PLAIN_TOKEN,
              metadata: { paymentRequestRole: 'payer', paymentRequestTransport: 'http' },
            }),
          },
          {
            note: 'Recipient claimed it',
            historyEntry: sendEntry('finalized', seed('pr-pay-http'), {
              ...PLAIN_TOKEN,
              metadata: { paymentRequestRole: 'payer', paymentRequestTransport: 'http' },
            }),
          },
        ],
      },
      {
        id: 'payment-request-undelivered',
        label: 'Request · Pay → never delivered, taken back',
        group: 'Request',
        variant: 'Pay undelivered',
        frames: [
          {
            note: 'Publishing to relays',
            historyEntry: sendEntry('pending', payUndelivered, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: false,
          },
          {
            note: 'Taken back',
            historyEntry: sendEntry('rolled_back', payUndelivered, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: false,
          },
        ],
      },
      {
        id: 'payment-request-cancelled',
        label: 'Request · Pay → delivered, then taken back',
        group: 'Request',
        variant: 'Pay reclaimed',
        frames: [
          {
            note: 'Relays accepted it',
            historyEntry: sendEntry('pending', payCancelled, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: true,
          },
          {
            note: 'Reclaim swap in flight',
            historyEntry: sendEntry('rolling_back', payCancelled, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: true,
          },
          {
            note: 'Taken back',
            historyEntry: sendEntry('rolled_back', payCancelled, PLAIN_TOKEN),
            tokenCreated: true,
            nostrSent: true,
          },
        ],
      },
      {
        id: 'payment-request-receive',
        label: 'Request · Receive over Nostr',
        group: 'Request',
        variant: 'Receive',
        frames: [
          { note: 'Request live, unpaid', historyEntry: awaiting(receive) },
          { note: 'Payment arrived, redeeming', historyEntry: claiming('prepared', receive) },
          { note: 'Redeemed', historyEntry: claiming('finalized', receive) },
        ],
      },
      {
        id: 'payment-request-receive-spent',
        label: 'Request · Receive → payment already spent',
        group: 'Request',
        variant: 'Receive spent',
        frames: [
          { note: 'Request live, unpaid', historyEntry: awaiting(receiveSpent) },
          { note: 'Payment arrived, redeeming', historyEntry: claiming('prepared', receiveSpent) },
          {
            note: 'Mint says spent (11001)',
            historyEntry: claiming('rolled_back', receiveSpent, { error: 'Token already spent' }),
          },
        ],
      },
    ];
  };

  return [...cashu(), ...locked(), ...lightning(), ...onchain(), ...request()];
}

// ---------------------------------------------------------------------------
// Code-state introspection
// ---------------------------------------------------------------------------

function entryState(entry: HistoryEntry): string {
  return entry.state;
}

function isOnchainEntry(entry: HistoryEntry): boolean {
  return entry.metadata?.method === 'onchain';
}

// The real normalizers from colada's one state owner — the debug readout can
// never drift from what buildTimeline actually renders.
const normalizeMintState = (raw: string): string => normalizeTimelineMintState(raw);
const normalizeMeltState = (raw: string) => normalizeTimelineMeltState(raw);

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

const MELT_MEANING: Record<ReturnType<typeof normalizeTimelineMeltState>, string> = {
  [MeltQuoteState.UNPAID]: 'Melt quote accepted — the wallet has not started paying yet.',
  [MeltQuoteState.PENDING]: 'Mint is paying the Lightning invoice — settlement in flight.',
  [MeltQuoteState.PAID]: 'Lightning invoice settled — the send is complete.',
};

const SEND_MEANING: Record<string, string> = {
  prepared: 'Proofs reserved from your balance — the token has not been built yet.',
  executing: 'Swapping at the mint for proofs of the exact amount.',
  rolling_back: 'Reclaim swap in flight — the outstanding proofs are being taken back.',
  rolled_back: 'Send reversed — the reserved proofs returned to your balance.',
  pending: 'Token is outstanding — waiting for the recipient to claim it.',
  finalized: 'Recipient claimed the token — the proofs are now spent.',
  rolledBack: 'Send reversed — the reserved proofs returned to your balance.',
};

const RECEIVE_MEANING: Record<string, string> = {
  prepared: 'Incoming token parsed — the swap with the mint is not finalized yet.',
  executing: 'Swap started and unanswered — retried when the mint is reachable.',
  rolled_back: 'Swap rejected by the mint — nothing was added.',
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
      if (raw === 'rolling_back') {
        return {
          source: 'coco · melt operation',
          code: 'op.state = "rolling_back"',
          meaning: 'Quote read back UNPAID — the reserved proofs are being restored.',
        };
      }
      if (raw === 'rolled_back' || raw === 'rolledBack' || raw === 'failed') {
        return {
          source: 'coco · melt operation',
          code: `op.state = "${raw}"`,
          meaning: entry.error
            ? `Reversed after a failed payment — ${entry.error}`
            : 'Reversed before any payment was attempted — proofs back in the balance.',
        };
      }
      const state = normalizeMeltState(raw);
      const expired = frame.meltQuote ? meltQuoteExpired(frame.meltQuote) : false;
      return {
        source: 'cashu-ts · MeltQuoteState',
        code: `MeltQuoteState.${state}`,
        meaning: expired
          ? 'Quote expiry timestamp passed — still UNPAID at the mint, surfaced to the user as expired.'
          : MELT_MEANING[state],
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
