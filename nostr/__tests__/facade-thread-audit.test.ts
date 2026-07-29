import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer, pendingFeedTier } from '../src/facade';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const ROOT = 'a'.repeat(64);
const OP = '1'.repeat(64);
const OTHER = '2'.repeat(64);
const KNOWN = 'b'.repeat(64); // direct reply the primary source already served
const EXTRA = 'c'.repeat(64); // direct reply ONLY the audit tier knows — the spam bucket
const OP_EXTRA = 'd'.repeat(64); // OP-authored direct reply the primary missed — promoted
const NESTED = 'e'.repeat(64); // reply to KNOWN, not to the root — never in the diff

function note(id: string, pubkey: string, tags: string[][], created_at: number): RawPrimalEvent {
  return { id, pubkey, kind: 1, content: `n ${id.slice(0, 4)}`, tags, created_at };
}

const AUDIT_BATCH: RawPrimalEvent[] = [
  note(ROOT, OP, [], 1_700_000_000),
  note(KNOWN, OTHER, [['e', ROOT, '', 'root']], 1_700_000_100),
  note(EXTRA, OTHER, [['e', ROOT, '', 'root']], 1_700_000_200),
  note(OP_EXTRA, OP, [['e', ROOT, '', 'root']], 1_700_000_300),
  note(NESTED, OTHER, [['e', ROOT, '', 'root'], ['e', KNOWN, '', 'reply']], 1_700_000_400),
];

function countingPrimal(events: RawPrimalEvent[]) {
  let calls = 0;
  const connection: PrimalConnection = {
    request: (): Promise<Result<RawPrimalEvent[], NaggError>> => {
      calls += 1;
      return Promise.resolve(ok(events));
    },
  };
  return { connection, calls: () => calls };
}

function countingRelay(events: RawRelayEvent[]) {
  let calls = 0;
  const connection: RelayConnection = {
    request: (): Promise<Result<RawRelayEvent[], NaggError>> => {
      calls += 1;
      return Promise.resolve(ok(events));
    },
  };
  return { connection, calls: () => calls };
}

describe('NostrDataLayer.auditThreadReplies — the "Might be spam" second opinion', () => {
  test('diffs direct replies against the known set; OP-authored extras split out; findings cached', async () => {
    const primal = countingPrimal(AUDIT_BATCH);
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createPrimalTier({ connection: primal.connection })],
    });

    const audit = await layer.auditThreadReplies({
      noteId: ROOT,
      opPubkey: OP,
      primaryTier: 'nagg',
      knownReplyIds: [KNOWN],
    });

    expect(audit.tier).toBe('primal');
    // KNOWN acknowledged, NESTED not a direct reply, ROOT excluded.
    expect(audit.extras.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([EXTRA]);
    expect(audit.opExtras.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([OP_EXTRA]);
    // Findings are cached for instant tap-through.
    expect(layer.cache.getNote(EXTRA)?.id).toBe(EXTRA);
    expect(layer.cache.getNote(OP_EXTRA)?.id).toBe(OP_EXTRA);
  });

  test('consults ONLY tiers strictly below the primary', async () => {
    const primal = countingPrimal(AUDIT_BATCH);
    const relay = countingRelay([]);
    const layer = createNostrDataLayer({
      tiers: [
        createPrimalTier({ connection: primal.connection }),
        createRelayTier({ connection: relay.connection }),
      ],
    });

    const audit = await layer.auditThreadReplies({
      noteId: ROOT,
      opPubkey: OP,
      primaryTier: 'primal',
      knownReplyIds: [],
    });

    // Primal was the primary — it must NOT be re-consulted; the empty relay
    // answer (no root delivered) exhausts to a normal null.
    expect(primal.calls()).toBe(0);
    expect(relay.calls()).toBeGreaterThan(0);
    expect(audit.tier).toBeNull();
    expect(audit.extras).toEqual([]);
  });

  test('primary at the bottom tier → nothing to consult, no fetches', async () => {
    const relay = countingRelay([]);
    const layer = createNostrDataLayer({
      tiers: [createRelayTier({ connection: relay.connection })],
    });
    const audit = await layer.auditThreadReplies({
      noteId: ROOT,
      opPubkey: OP,
      primaryTier: 'relay',
      knownReplyIds: [],
    });
    expect(relay.calls()).toBe(0);
    expect(audit.tier).toBeNull();
  });

  test('memoizes per note — a re-open within the TTL reuses the first fan-out', async () => {
    const primal = countingPrimal(AUDIT_BATCH);
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createPrimalTier({ connection: primal.connection })],
    });
    const request = { noteId: ROOT, opPubkey: OP, primaryTier: 'nagg' as const, knownReplyIds: [KNOWN] };

    const first = await layer.auditThreadReplies(request);
    const callsAfterFirst = primal.calls();
    const second = await layer.auditThreadReplies(request);

    expect(primal.calls()).toBe(callsAfterFirst); // no second network fan-out
    expect(second.extras.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual(
      first.extras.map((i) => (i.type === 'note' ? i.event.id : '')),
    );
  });
});
