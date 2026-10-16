// Brute force over the timeline's whole input space.
//
// Every flow is described as a set of NODES (one concrete combination of the
// inputs the engine reads) and an EDGE relation (which node can follow which,
// including the backwards steps the protocol and the chain really take). The
// walk visits every reachable (node, rows-already-drawn) pair, the way a
// mounted timeline would, and checks the same promises on each:
//
//   • a row, once drawn, is never taken away and never moves;
//   • there is at most one open row and it is the last one;
//   • a row that finishes changes its wording (the tense has to turn);
//   • nothing is blank, duplicated, or unrenderable.

import { describe, expect, it } from 'vitest';

import { buildTimelineModel } from '../../src/history';
import { decodeBolt11Invoice } from '../../src/bolt11';
import type { BuildTimelineInput, TimelineModel } from '../../src/history';

const CREATED_AT = 1_800_000_000_000;
const LATER = CREATED_AT + 90_000;

type Input = Omit<BuildTimelineInput, 'doneRowKeys'>;
interface Node {
  name: string;
  input: Input;
  /** Free-form coordinates the flow's edge relation reads. */
  at: Record<string, number | string | boolean>;
}
interface Space {
  flow: string;
  nodes: Node[];
  start(node: Node): boolean;
  edge(from: Node, to: Node): boolean;
}

const OPEN = new Set(['current', 'next-pending', 'waiting']);
const DONE = new Set(['complete', 'success']);

function checkFrame(where: string, model: TimelineModel) {
  const { steps } = model;
  expect(steps.length, `${where}: rendered nothing`).toBeGreaterThan(0);
  const keys = steps.map((step) => step.rowKey);
  expect(new Set(keys).size, `${where}: duplicate row ${keys.join(',')}`).toBe(keys.length);
  steps.forEach((step, index) => {
    expect(step.displayLabel.trim(), `${where}: blank label on ${step.rowKey}`).not.toBe('');
    if (step.info !== undefined) {
      expect(step.info.trim(), `${where}: blank info on ${step.rowKey}`).not.toBe('');
    }
    if (index < steps.length - 1) {
      expect(DONE.has(step.stepType), `${where}: ${step.rowKey} is ${step.stepType} above the last row`).toBe(true);
    }
  });
  const last = steps[steps.length - 1];
  expect(model.outcome.kind === 'pending', `${where}: outcome ${model.outcome.kind} vs last row ${last.stepType}`).toBe(
    OPEN.has(last.stepType)
  );
}

function checkTransition(where: string, before: TimelineModel, after: TimelineModel) {
  const beforeKeys = before.steps.map((step) => step.rowKey);
  const afterKeys = after.steps.map((step) => step.rowKey);
  expect(afterKeys.slice(0, beforeKeys.length), `${where}: rows removed or moved`).toEqual(beforeKeys);
  before.steps.forEach((was, index) => {
    const now = after.steps[index];
    if (DONE.has(was.stepType)) {
      expect(DONE.has(now.stepType), `${where}: finished row ${was.rowKey} reopened`).toBe(true);
      // An event keeps its wording for good. A verdict standing in a slot
      // ("Settled off-chain") may be corrected by the event itself turning up
      // ("Broadcast"): that is a different row id in the same slot.
      if (was.id === now.id) {
        expect(now.displayLabel, `${where}: finished row ${was.rowKey} was reworded`).toBe(
          was.displayLabel
        );
      }
    } else if (now.stepType === 'complete' || (now.stepType === 'success' && now.id === was.id)) {
      expect(now.displayLabel, `${where}: ${was.rowKey} finished without changing tense`).not.toBe(
        was.displayLabel
      );
    }
  });
}

/** Every reachable (node, rows-already-drawn) pair, each edge checked once. */
function walk(space: Space): { frames: number; transitions: number; visited: Set<string> } {
  const seen = new Set<string>();
  const visited = new Set<string>();
  let transitions = 0;
  const queue: { node: Node; done: string[]; model: TimelineModel }[] = [];
  const visit = (node: Node, done: string[], from?: { name: string; model: TimelineModel }) => {
    const model = buildTimelineModel({ ...node.input, doneRowKeys: done });
    const where = `${space.flow} ${from ? `${from.name} → ` : ''}${node.name} [drawn: ${done.join(',') || '-'}]`;
    checkFrame(where, model);
    // A mounted timeline feeds the model its own answer back on the next
    // render, so that has to be a fixed point: same rows, nothing doubled.
    const again = buildTimelineModel({ ...node.input, doneRowKeys: model.doneRowKeys });
    expect(again, `${where}: not stable when rebuilt from its own rows`).toEqual(model);
    if (from) {
      checkTransition(where, from.model, model);
      transitions += 1;
    }
    const id = `${node.name}|${model.doneRowKeys.join(',')}`;
    if (seen.has(id)) return;
    seen.add(id);
    visited.add(node.name);
    queue.push({ node, done: model.doneRowKeys, model });
  };
  space.nodes.filter(space.start).forEach((node) => visit(node, []));
  // Also open every node cold: a detail screen mounts on whatever it finds.
  space.nodes.forEach((node) => visit(node, []));
  while (queue.length > 0) {
    const { node, done, model } = queue.shift()!;
    for (const next of space.nodes) {
      if (next !== node && space.edge(node, next)) visit(next, done, { name: node.name, model });
    }
  }
  return { frames: seen.size, transitions, visited };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const base = { mintUrl: 'https://mint.example.com', unit: 'sat', createdAt: CREATED_AT };
const entry = (fields: Record<string, unknown>) => ({ ...base, updatedAt: CREATED_AT, ...fields }) as never;

// BOLT11 spec vector: created 1496314658, default one-hour expiry.
const INVOICE =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
const INVOICE_EXPIRES_AT = (1496314658 + 3600) * 1000;

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

function mintNodes(onchain: boolean): Node[] {
  const nodes: Node[] = [];
  MINT_STATES.forEach((value, stateIndex) => {
    const mint = entry({
      id: 'mint-1',
      type: 'mint',
      state: value.state,
      amount: 21_000,
      quoteId: 'q1',
      paymentRequest: onchain ? '' : INVOICE,
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
          input: { historyEntry: mint, currentTime: INVOICE_EXPIRES_AT + (expired ? 1 : -1) },
          at: { stateIndex, expired },
        });
      });
    }
  });
  return nodes;
}

const mintSpace = (onchain: boolean): Space => ({
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

function meltNodes(onchain: boolean): Node[] {
  const nodes: Node[] = [];
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

const meltSpace = (onchain: boolean): Space => ({
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

function sendNodes(lock: string): Node[] {
  const nodes: Node[] = [];
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

const sendSpace = (lock: string): Space => ({
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

function paymentRequestSendNodes(): Node[] {
  const nodes: Node[] = [];
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

const paymentRequestSendSpace: Space = {
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

const receiveSpace: Space = {
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

function paymentRequestReceiveNodes(): Node[] {
  const nodes: Node[] = [
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

const paymentRequestReceiveSpace: Space = {
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

const SPACES: Space[] = [
  mintSpace(false),
  mintSpace(true),
  meltSpace(false),
  meltSpace(true),
  ...Object.keys(LOCKS).map(sendSpace),
  paymentRequestSendSpace,
  receiveSpace,
  paymentRequestReceiveSpace,
];

/** Registers the walk. Called once per reclaim-gate setting. */
export function defineTimelineBruteForce(setting: string): void {
describe(`timeline — brute force over every state (${setting})`, () => {
  it('the invoice fixture decodes, so the expiry axis is real', () => {
    const decoded = decodeBolt11Invoice(INVOICE);
    expect(((decoded?.timestampSec ?? 0) + (decoded?.expirySec ?? 3600)) * 1000).toBe(INVOICE_EXPIRES_AT);
  });

  it.each(SPACES.map((space) => [space.flow, space] as const))(
    '%s: rows are only ever added, from every state to every state that can follow',
    (_flow, space) => {
      const result = walk(space);
      // Every node the space declares was actually rendered.
      expect([...result.visited].sort()).toEqual(space.nodes.map((node) => node.name).sort());
      expect(result.transitions).toBeGreaterThan(space.nodes.length);
    }
  );

  it('renders something for a state no flow has heard of, or renders nothing — never throws', () => {
    for (const type of ['mint', 'melt', 'send', 'receive', 'swap']) {
      for (const state of ['init', 'weird', '', 'PENDING', 'needs_attention']) {
        const build = () =>
          buildTimelineModel({
            historyEntry: entry({ id: 'x', type, state, amount: 1, quoteId: 'q', paymentRequest: '' }),
            currentTime: CREATED_AT,
          });
        expect(build, `${type}/${state}`).not.toThrow();
        const model = build();
        if (model.steps.length > 0) checkFrame(`${type}/${state}`, model);
      }
    }
  });
});
}
