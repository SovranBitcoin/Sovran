// The timeline's whole input space, as data.
//
// Every flow is described as a set of NODES (one concrete combination of the
// inputs the engine reads) and an EDGE relation (which node can follow which,
// including the backwards steps the protocol and the chain really take).
// `walkTimelineSpace` visits every reachable (node, rows-already-drawn) pair,
// the way a mounted timeline would.
//
// Two readers share it so they cannot drift: the brute-force test checks the
// engine's promises on every frame, and the design-system matrix page draws
// every frame. It is fixture data, imported only through `wallet/timeline-space`.

import type { PaymentCopyResolver } from '../../copy';
import { transactionHeaderPhase, transactionHeaderTitle } from '../header-title';
import { getCardLabel, getStatusColorType, getStatusHeader } from './classify';
import { DEFAULT_PAYMENT_COPY } from './context';
import { buildTimelineModel } from './engine';
import type { BuildTimelineInput, TimelineModel } from './types';

const CREATED_AT = 1_800_000_000_000;
const LATER = CREATED_AT + 90_000;

type Input = Omit<BuildTimelineInput, 'doneRowKeys'>;

/** One concrete combination of the inputs the engine reads. */
export interface TimelineSpaceNode {
  name: string;
  input: Input;
  /** Free-form coordinates the flow's edge relation reads. */
  at: Record<string, number | string | boolean>;
}

export interface TimelineSpace {
  flow: string;
  nodes: TimelineSpaceNode[];
  start(node: TimelineSpaceNode): boolean;
  edge(from: TimelineSpaceNode, to: TimelineSpaceNode): boolean;
}

/** A node as a mounted timeline would draw it, given the rows it had drawn. */
export interface TimelineFrame {
  /** Unique within its space: the node and the rows already drawn. */
  id: string;
  node: TimelineSpaceNode;
  /** The rows the timeline had drawn as finished before this node arrived. */
  drawn: readonly string[];
  /** The node this frame was reached from; absent for a cold open. */
  from?: { name: string; model: TimelineModel };
  model: TimelineModel;
}

/**
 * Visits every reachable (node, rows-already-drawn) pair. `onVisit` is called
 * for every arrival, including repeat arrivals over a different edge, so a
 * caller can check each transition; the returned frames are the distinct pairs.
 */
export function walkTimelineSpace(
  space: TimelineSpace,
  onVisit?: (frame: TimelineFrame) => void
): TimelineFrame[] {
  const frames = new Map<string, TimelineFrame>();
  const queue: TimelineFrame[] = [];
  const visit = (
    node: TimelineSpaceNode,
    drawn: readonly string[],
    from?: TimelineFrame['from']
  ) => {
    const model = buildTimelineModel({ ...node.input, doneRowKeys: drawn });
    const id = `${node.name}|${model.doneRowKeys.join(',')}`;
    const frame: TimelineFrame = { id, node, drawn, model, ...(from ? { from } : {}) };
    onVisit?.(frame);
    if (frames.has(id)) return;
    frames.set(id, frame);
    queue.push(frame);
  };
  space.nodes.filter(space.start).forEach((node) => visit(node, []));
  // Also open every node cold: a detail screen mounts on whatever it finds.
  space.nodes.forEach((node) => visit(node, []));
  while (queue.length > 0) {
    const { node, model } = queue.shift()!;
    for (const next of space.nodes) {
      if (next !== node && space.edge(node, next)) {
        visit(next, model.doneRowKeys, { name: node.name, model });
      }
    }
  }
  return [...frames.values()];
}

/** Everything on a detail screen that names where the transaction is. */
interface TimelineSurfaces {
  cardLabel: string;
  statusHeader: string;
  statusColor: ReturnType<typeof getStatusColorType>;
  /** The title the detail screen shows: read with the timeline it draws. */
  headerTitle: string;
  headerPhase: string;
  /**
   * Set when the screen title and the timeline tell different stories, as
   * "title says X, timeline says Y".
   */
  disagreement: string | null;
  /**
   * The same check for the title read off the entry alone: what a caller
   * without the timeline shows, and what the screen shows until the timeline
   * has reported. The entry cannot know the quote's expiry, our explorer's
   * count or a cancel tap.
   */
  entryOnlyDisagreement: string | null;
  /** Set when the card's label and the timeline under it disagree. */
  cardDisagreement: string | null;
}

// The title's phases for each way a timeline can end. An open timeline is
// either ready or in flight; the title cannot tell a stall from a wait.
const TITLE_PHASES: Record<TimelineModel['outcome']['kind'], readonly string[]> = {
  pending: ['ready', 'inFlight'],
  settled: ['settled'],
  expired: ['expired'],
  failed: ['failed'],
  'rolled-back': ['cancelled'],
  'already-spent': ['failed'],
  empty: [],
};

function titleDisagreement(phase: string, model: TimelineModel): string | null {
  const { steps, outcome } = model;
  // A reversed melt with a recorded failure ends in the rolled-back kind, but
  // it is a failed payment, not a cancellation: the row says "Payment failed".
  const paymentFailed = steps.some((step) => step.id === 'payment-failed');
  // A reversal in flight has not ended yet: the title may not call it done.
  const reversing = steps.some((step) => step.id === 'cancelling');
  const expected = paymentFailed
    ? ['failed']
    : reversing
      ? ['reversing']
      : TITLE_PHASES[outcome.kind];
  return expected.length > 0 && !expected.includes(phase)
    ? `title says ${phase}, timeline says ${outcome.kind}`
    : null;
}

// Which endings each card status may sit over. "Ready" is the one open
// status with a claim about the open row: nothing is under way yet.
const CARD_STATUS_OUTCOMES: Record<string, readonly TimelineModel['outcome']['kind'][]> = {
  complete: ['settled'],
  failed: ['failed', 'already-spent'],
  expired: ['expired'],
  cancelled: ['rolled-back'],
  alreadySpent: ['already-spent'],
  notAdded: ['already-spent'],
  ready: ['pending'],
  inProgress: ['pending'],
  waiting: ['pending'],
  awaitingPayment: ['pending'],
  pending: ['pending'],
};

function cardDisagreement(cardLabel: string, model: TimelineModel): string | null {
  const status = cardLabel.split(' • ')[1];
  if (status === undefined) return null;
  const key = Object.keys(CARD_STATUS_OUTCOMES).find(
    (candidate) => DEFAULT_PAYMENT_COPY.text(`timeline.status.${candidate}` as never) === status
  );
  if (!key) return `card says ${status}, which no ending explains`;
  const { steps, outcome } = model;
  const paymentFailed = steps.some((step) => step.id === 'payment-failed');
  const kind = paymentFailed ? 'failed' : outcome.kind;
  if (!CARD_STATUS_OUTCOMES[key].includes(kind)) return `card says ${key}, timeline says ${kind}`;
  const open = steps[steps.length - 1];
  if (key === 'ready' && (open?.stepType === 'current' || open?.stepType === 'waiting')) {
    return 'card says ready, timeline is working';
  }
  return null;
}

export function describeTimelineSurfaces(
  frame: Pick<TimelineFrame, 'node' | 'model'>,
  paymentCopy?: PaymentCopyResolver
): TimelineSurfaces {
  const { historyEntry, tokenCreated, nostrSent } = frame.node.input;
  const { model } = frame;
  const { steps, outcome } = model;
  const headerPhase = transactionHeaderPhase(historyEntry, model);
  const entryPhase = transactionHeaderPhase(historyEntry);
  // The entry decides a mint invoice's expiry by the device clock, the fixture
  // by its own; an open timeline under an "expired" title is that difference.
  const clockArtefact = entryPhase === 'expired' && outcome.kind === 'pending';
  const cardLabel = getCardLabel(historyEntry, steps, tokenCreated, nostrSent, paymentCopy);
  return {
    cardLabel,
    statusHeader: getStatusHeader(steps),
    statusColor: getStatusColorType(steps),
    headerTitle: transactionHeaderTitle(historyEntry, {
      timeline: model,
      ...(paymentCopy ? { paymentCopy } : {}),
    }),
    headerPhase,
    disagreement: titleDisagreement(headerPhase, model),
    entryOnlyDisagreement: clockArtefact ? null : titleDisagreement(entryPhase, model),
    // Only with the default wording: the check matches the label's words.
    cardDisagreement: paymentCopy ? null : cardDisagreement(cardLabel, model),
  };
}

/** What a person can tell apart on screen: the rows and how the flow ended. */
export function timelineFrameAppearance(frame: Pick<TimelineFrame, 'model'>): string {
  return [
    frame.model.outcome.kind,
    ...frame.model.steps.map(
      (step) => `${step.rowKey}:${step.stepType}:${step.displayLabel}:${step.info ?? ''}`
    ),
  ].join('|');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const base = { mintUrl: 'https://mint.example.com', unit: 'sat', createdAt: CREATED_AT };
const entry = (fields: Record<string, unknown>) => ({ ...base, updatedAt: CREATED_AT, ...fields }) as never;

// BOLT11 spec vector: created 1496314658, default one-hour expiry.
export const TIMELINE_SPACE_INVOICE =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
export const TIMELINE_SPACE_INVOICE_EXPIRES_AT = (1496314658 + 3600) * 1000;

type Progress = NonNullable<BuildTimelineInput['onchainConfirmationProgress']>;
const REQUIRED = 6;
const PROGRESS: Record<string, Progress | null | undefined> = {
  absent: undefined,
  unseen: {
    hasPayment: false,
    hasUnconfirmedPayment: false,
    receivedSats: 0,
    currentConfirmations: null,
    requiredConfirmations: REQUIRED,
    isSatisfied: false,
  },
  mempool: {
    hasPayment: true,
    hasUnconfirmedPayment: true,
    receivedSats: 21_000,
    currentConfirmations: null,
    requiredConfirmations: REQUIRED,
    isSatisfied: false,
  },
  ...Object.fromEntries(
    [1, 3, 6, 12].map((confirmations) => [
      `conf${confirmations}`,
      {
        hasPayment: true,
        hasUnconfirmedPayment: false,
        receivedSats: 21_000,
        // The ring's count is capped at the requirement; the depth our
        // explorer really sees is not.
        currentConfirmations: Math.min(confirmations, REQUIRED),
        requiredConfirmations: REQUIRED,
        isSatisfied: confirmations >= REQUIRED,
        observedConfirmations: confirmations,
        requirementFromMint: true,
      },
    ])
  ),
};
const PROGRESS_KEYS = Object.keys(PROGRESS);

/** A state axis in both vocabularies: `rank` orders progress, and anything
 *  with a `terminal` tag can be entered from any live rank at or below `from`. */
interface StateValue {
  state: string;
  rank: number;
  terminal?: boolean;
  reversing?: boolean;
  extra?: Record<string, unknown>;
}

function stateEdge(from: StateValue, to: StateValue, opts: { backwards?: boolean } = {}): boolean {
  // The operation ending does not stop the other observers: the explorer keeps
  // counting, the clock keeps running, an outpoint turns up late. So an ended
  // operation may be seen again, unchanged, with everything around it moved.
  if (from === to) return true;
  if (from.terminal) return false;
  if (to.terminal) return true;
  if (from.reversing) return !!to.reversing;
  if (to.reversing) return true;
  return opts.backwards ? true : to.rank >= from.rank;
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

const MINT_STATES: StateValue[] = [
  { state: 'UNPAID', rank: 0 },
  { state: 'pending', rank: 0 },
  { state: 'pending', rank: 1, extra: { remoteState: 'PAID' } },
  { state: 'PAID', rank: 1 },
  { state: 'executing', rank: 1 },
  { state: 'ISSUED', rank: 2, terminal: true },
  { state: 'finalized', rank: 2, terminal: true },
  { state: 'failed', rank: 9, terminal: true },
  { state: 'failed', rank: 9, terminal: true, extra: { remoteState: 'PAID' } },
  { state: 'failed', rank: 9, terminal: true, extra: { error: 'Quote expired (20007)' } },
  // What the history list hands over for a failed mint.
  { state: 'UNPAID', rank: 9, terminal: true, extra: { operationState: 'failed' } },
  // The mint says ISSUED; the wallet has not got the ecash.
  { state: 'pending', rank: 1, extra: { remoteState: 'ISSUED' } },
  // Finished with nothing restored.
  {
    state: 'finalized',
    rank: 2,
    terminal: true,
    extra: { error: 'Recovered issued quote but no proofs could be restored' },
  },
];

function mintNodes(onchain: boolean): TimelineSpaceNode[] {
  const nodes: TimelineSpaceNode[] = [];
  MINT_STATES.forEach((value, stateIndex) => {
    const mint = entry({
      id: 'mint-1',
      type: 'mint',
      state: value.state,
      amount: 21_000,
      quoteId: 'q1',
      paymentRequest: onchain ? '' : TIMELINE_SPACE_INVOICE,
      ...(onchain ? { metadata: { method: 'onchain', onchainAddress: 'bc1qexample' } } : {}),
      ...value.extra,
    });
    if (onchain) {
      PROGRESS_KEYS.forEach((key) => {
        nodes.push({
          name: `${value.state}#${stateIndex}/${key}`,
          input: { historyEntry: mint, currentTime: CREATED_AT, onchainConfirmationProgress: PROGRESS[key] },
          at: { stateIndex, progress: key },
        });
      });
    } else {
      [false, true].forEach((expired) => {
        nodes.push({
          name: `${value.state}#${stateIndex}/${expired ? 'past-expiry' : 'in-time'}`,
          input: { historyEntry: mint, currentTime: TIMELINE_SPACE_INVOICE_EXPIRES_AT + (expired ? 1 : -1) },
          at: { stateIndex, expired },
        });
      });
    }
  });
  return nodes;
}

const mintSpace = (onchain: boolean): TimelineSpace => ({
  flow: onchain ? 'onchain-mint' : 'lightning-mint',
  nodes: mintNodes(onchain),
  start: (node) => MINT_STATES[node.at.stateIndex as number].rank === 0,
  edge: (from, to) =>
    // coco steps a mint back from `executing` to `pending` when a claim fails,
    // and the chain is free to do anything, so both axes may go backwards.
    stateEdge(MINT_STATES[from.at.stateIndex as number], MINT_STATES[to.at.stateIndex as number], {
      backwards: true,
    }) &&
    (onchain || !from.at.expired || !!to.at.expired),
});

// ---------------------------------------------------------------------------
// Melt
// ---------------------------------------------------------------------------

const MELT_STATES: StateValue[] = [
  { state: 'UNPAID', rank: 0 },
  { state: 'prepared', rank: 0 },
  { state: 'executing', rank: 1 },
  { state: 'PENDING', rank: 1 },
  { state: 'pending', rank: 1 },
  { state: 'PAID', rank: 2, terminal: true },
  { state: 'finalized', rank: 2, terminal: true },
  { state: 'rolling_back', rank: 8, reversing: true },
  { state: 'rolled_back', rank: 9, terminal: true },
  { state: 'rolledBack', rank: 9, terminal: true },
  { state: 'failed', rank: 9, terminal: true },
  { state: 'rolled_back', rank: 9, terminal: true, extra: { error: 'Recovered: payment failed' } },
  { state: 'rolled_back', rank: 9, terminal: true, extra: { error: 'User cancelled' } },
  { state: 'rolled_back', rank: 9, terminal: true, extra: { error: 'Rollback requested by handler' } },
];

function meltNodes(onchain: boolean): TimelineSpaceNode[] {
  const nodes: TimelineSpaceNode[] = [];
  MELT_STATES.forEach((value, stateIndex) => {
    const melt = entry({
      id: 'melt-1',
      type: 'melt',
      state: value.state,
      amount: 5_000,
      quoteId: 'mq1',
      operationId: 'op-1',
      ...(onchain ? { metadata: { method: 'onchain', onchainAddress: 'bc1qexample' } } : {}),
      ...(value.terminal ? { updatedAt: LATER } : {}),
      ...value.extra,
    });
    const expiry = Math.floor(CREATED_AT / 1000) + 600;
    const quote = { expiry } as never;
    if (onchain) {
      PROGRESS_KEYS.forEach((key) => {
        [false, true].forEach((offchain) => {
          // Off-chain settlement is only ever asserted on a PAID quote.
          if (offchain && value.rank !== 2) return;
          nodes.push({
            name: `${value.state}#${stateIndex}/${key}${offchain ? '/offchain' : ''}`,
            input: {
              historyEntry: melt,
              currentTime: CREATED_AT,
              onchainConfirmationProgress: PROGRESS[key],
              onchainSettledInternally: offchain,
            },
            at: { stateIndex, progress: key, offchain },
          });
        });
      });
    } else {
      (['no-quote', 'in-time', 'past-expiry', 'much-later'] as const).forEach((clock) => {
        nodes.push({
          name: `${value.state}#${stateIndex}/${clock}`,
          input: {
            historyEntry: melt,
            currentTime:
              clock === 'past-expiry'
                ? (expiry + 5) * 1000
                : clock === 'much-later'
                  ? CREATED_AT + 3_600_000
                  : CREATED_AT,
            ...(clock === 'no-quote' || clock === 'much-later' ? {} : { meltQuote: quote }),
          },
          at: { stateIndex, clock },
        });
      });
    }
  });
  return nodes;
}

const CLOCK_RANK = { 'no-quote': 0, 'in-time': 0, 'past-expiry': 1, 'much-later': 2 } as const;

const meltSpace = (onchain: boolean): TimelineSpace => ({
  flow: onchain ? 'onchain-melt' : 'lightning-melt',
  nodes: meltNodes(onchain),
  start: (node) => MELT_STATES[node.at.stateIndex as number].rank === 0,
  edge: (from, to) =>
    // A melt quote legally falls from PENDING back to UNPAID when the payment
    // fails before coco has reversed the operation.
    stateEdge(MELT_STATES[from.at.stateIndex as number], MELT_STATES[to.at.stateIndex as number], {
      backwards: true,
    }) &&
    (onchain ||
      CLOCK_RANK[to.at.clock as keyof typeof CLOCK_RANK] >=
        CLOCK_RANK[from.at.clock as keyof typeof CLOCK_RANK]) &&
    // The off-chain verdict is withdrawn only by an outpoint turning up, and
    // the send screen then reports that transaction as seen (its own count, or
    // the mint's PAID standing in for it). It is never withdrawn into nothing.
    (!from.at.offchain || !!to.at.offchain || !!PROGRESS[to.at.progress as string]?.hasPayment),
});

// ---------------------------------------------------------------------------
// Send (plain, locked, payment request)
// ---------------------------------------------------------------------------

const SEND_STATES: StateValue[] = [
  { state: 'prepared', rank: 0 },
  { state: 'executing', rank: 0 },
  { state: 'pending', rank: 1 },
  { state: 'finalized', rank: 2, terminal: true },
  { state: 'rolling_back', rank: 8, reversing: true },
  { state: 'rolled_back', rank: 9, terminal: true },
  { state: 'rolledBack', rank: 9, terminal: true },
];

const OUR_KEY = `02${'11'.repeat(32)}`;
const THEIR_KEY = `02${'22'.repeat(32)}`;
const LOCKTIME_SEC = Math.floor(CREATED_AT / 1000) + 3600;
const UNLOCK_AT = LOCKTIME_SEC * 1000;
const token = (tags: string[][] | null) => ({
  proofs: [
    {
      secret:
        tags === null
          ? 'plain-secret'
          : JSON.stringify(['P2PK', { nonce: 'ab'.repeat(16), data: THEIR_KEY, tags }]),
    },
  ],
});

const LOCKS: Record<string, string[][] | null> = {
  none: null,
  permanent: [],
  'timed-refund': [
    ['locktime', String(LOCKTIME_SEC)],
    ['refund', OUR_KEY],
  ],
  'timed-public': [['locktime', String(LOCKTIME_SEC)]],
  'timed-refund-theirs': [
    ['locktime', String(LOCKTIME_SEC)],
    ['refund', THEIR_KEY],
  ],
};

function sendNodes(lock: string): TimelineSpaceNode[] {
  const nodes: TimelineSpaceNode[] = [];
  const timed = lock.startsWith('timed');
  SEND_STATES.forEach((value, stateIndex) => {
    // A token exists from `pending` on; a rolled-back send may or may not
    // still carry one. A lock is only knowable through the token.
    const tokenOptions = value.rank === 0 ? [lock === 'none' ? false : true] : value.rank >= 8 && lock === 'none' ? [false, true] : [true];
    tokenOptions.forEach((withToken) => {
      (timed ? [false, true] : [false]).forEach((afterUnlock) => {
        [false, true].forEach((cancelling) => {
          if (cancelling && (value.terminal || value.reversing)) return;
          const now = afterUnlock ? UNLOCK_AT + 120_000 : CREATED_AT;
          nodes.push({
            name: `${value.state}#${stateIndex}/${withToken ? 'token' : 'no-token'}${timed ? (afterUnlock ? '/unlocked' : '/locked') : ''}${cancelling ? '/cancelling' : ''}`,
            input: {
              historyEntry: entry({
                id: 'send-1',
                type: 'send',
                state: value.state,
                amount: 100,
                operationId: 'op-1',
                ...(withToken ? { token: token(LOCKS[lock]) } : {}),
                ...(value.terminal ? { updatedAt: now + 1 } : {}),
              }),
              currentTime: now,
              ourPubkeys: [OUR_KEY],
              cancelling,
            },
            at: { stateIndex, afterUnlock, cancelling, withToken },
          });
        });
      });
    });
  });
  return nodes;
}

const sendSpace = (lock: string): TimelineSpace => ({
  flow: lock === 'none' ? 'send' : `locked-send(${lock})`,
  nodes: sendNodes(lock),
  start: (node) => SEND_STATES[node.at.stateIndex as number].rank === 0 && !node.at.afterUnlock,
  edge: (from, to) =>
    stateEdge(SEND_STATES[from.at.stateIndex as number], SEND_STATES[to.at.stateIndex as number]) &&
    // The clock only runs forwards; a cancel tap may be answered or fail.
    (!from.at.afterUnlock || !!to.at.afterUnlock) &&
    // For an ended send `afterUnlock` is WHEN it ended, which is fixed.
    (!SEND_STATES[from.at.stateIndex as number].terminal || from.at.afterUnlock === to.at.afterUnlock) &&
    (!from.at.withToken || !!to.at.withToken),
});

function paymentRequestSendNodes(): TimelineSpaceNode[] {
  const nodes: TimelineSpaceNode[] = [];
  SEND_STATES.forEach((value, stateIndex) => {
    [false, true].forEach((tokenCreated) => {
      ([undefined, false, true] as const).forEach((nostrSent) => {
        if (nostrSent && !tokenCreated) return;
        if (value.rank >= 1 && value.rank <= 2 && !tokenCreated) return;
        nodes.push({
          name: `${value.state}#${stateIndex}/token:${tokenCreated}/nostr:${String(nostrSent)}`,
          input: {
            historyEntry: entry({
              id: 'send-pr-1',
              type: 'send',
              state: value.state,
              amount: 100,
              operationId: 'op-1',
              ...(value.terminal ? { updatedAt: LATER } : {}),
            }),
            currentTime: CREATED_AT,
            tokenCreated,
            nostrSent,
          },
          at: { stateIndex, tokenCreated, nostr: nostrSent ? 1 : 0 },
        });
      });
    });
  });
  return nodes;
}

const paymentRequestSendSpace: TimelineSpace = {
  flow: 'payment-request-send',
  nodes: paymentRequestSendNodes(),
  start: (node) => SEND_STATES[node.at.stateIndex as number].rank === 0 && !node.at.tokenCreated,
  edge: (from, to) =>
    stateEdge(SEND_STATES[from.at.stateIndex as number], SEND_STATES[to.at.stateIndex as number]) &&
    (!from.at.tokenCreated || !!to.at.tokenCreated) &&
    (to.at.nostr as number) >= (from.at.nostr as number),
};

// ---------------------------------------------------------------------------
// Receive (token, payment request)
// ---------------------------------------------------------------------------

const RECEIVE_STATES: StateValue[] = [
  { state: 'prepared', rank: 0 },
  { state: 'executing', rank: 1 },
  { state: 'finalized', rank: 2, terminal: true },
  { state: 'rolled_back', rank: 9, terminal: true, extra: { error: 'Token already spent' } },
  { state: 'rolledBack', rank: 9, terminal: true, extra: { error: 'Keyset is inactive (12002)' } },
  { state: 'rolled_back', rank: 9, terminal: true },
];

const receiveSpace: TimelineSpace = {
  flow: 'receive',
  nodes: RECEIVE_STATES.map((value, stateIndex) => ({
    name: `${value.state}#${stateIndex}`,
    input: {
      historyEntry: entry({
        id: 'receive-1',
        type: 'receive',
        state: value.state,
        amount: 100,
        operationId: 'op-1',
        ...(value.terminal ? { updatedAt: LATER } : {}),
        ...value.extra,
      }),
      currentTime: CREATED_AT,
    },
    at: { stateIndex },
  })),
  start: (node) => RECEIVE_STATES[node.at.stateIndex as number].rank === 0,
  // An `executing` receive that cannot reach the mint is put back to wait.
  edge: (from, to) =>
    stateEdge(RECEIVE_STATES[from.at.stateIndex as number], RECEIVE_STATES[to.at.stateIndex as number], {
      backwards: true,
    }),
};

function paymentRequestReceiveNodes(): TimelineSpaceNode[] {
  const nodes: TimelineSpaceNode[] = [
    {
      name: 'waiting-for-payer',
      input: {
        historyEntry: entry({
          id: 'receive-pr-1',
          type: 'receive',
          state: 'executing',
          amount: 100,
          operationId: 'op-1',
          metadata: { paymentRequestPending: '1' },
        }),
        currentTime: CREATED_AT,
      },
      at: { stateIndex: -1 },
    },
  ];
  RECEIVE_STATES.forEach((value, stateIndex) => {
    nodes.push({
      name: `${value.state}#${stateIndex}`,
      input: {
        historyEntry: entry({
          id: 'receive-pr-1',
          type: 'receive',
          state: value.state,
          amount: 100,
          operationId: 'op-1',
          metadata: { source: 'payment-request' },
          ...(value.terminal ? { updatedAt: LATER } : {}),
          ...value.extra,
        }),
        currentTime: CREATED_AT,
      },
      at: { stateIndex },
    });
  });
  return nodes;
}

const paymentRequestReceiveSpace: TimelineSpace = {
  flow: 'payment-request-receive',
  nodes: paymentRequestReceiveNodes(),
  start: (node) => node.at.stateIndex === -1,
  edge: (from, to) =>
    to.at.stateIndex !== -1 &&
    (from.at.stateIndex === -1 ||
      stateEdge(RECEIVE_STATES[from.at.stateIndex as number], RECEIVE_STATES[to.at.stateIndex as number], {
        backwards: true,
      })),
};

// ---------------------------------------------------------------------------

/** Every flow's nodes and edges, in the order the matrix page lists them. */
export const TIMELINE_SPACES: readonly TimelineSpace[] = [
  mintSpace(false),
  mintSpace(true),
  meltSpace(false),
  meltSpace(true),
  ...Object.keys(LOCKS).map(sendSpace),
  paymentRequestSendSpace,
  receiveSpace,
  paymentRequestReceiveSpace,
];
