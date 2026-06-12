import { describe, expect, it, vi } from 'vitest';
import { PaymentRequest, getEncodedToken } from '@cashu/cashu-ts';
import {
  classifyMeshToken,
  meshTokenDedupeKey,
} from '../../src/transport/classify';
import {
  normalizeMintUrl,
  parseMeshPaymentRequest,
  planMeshSend,
  type MeshSolicitOutcome,
} from '../../src/transport/plan';
import { createMeshRequestResponder } from '../../src/transport/requestResponder';
import { validateInboundMeshPayment } from '../../src/transport/validateInboundPayment';
import { createMeshPaymentIntake } from '../../src/transport/paymentIntake';
import { createMeshDeliveryTracker } from '../../src/transport/deliveryTracker';
import {
  classifyMeshRedeemError,
  createMeshRedeemOrchestrator,
  type MeshRedeemEntry,
} from '../../src/transport/redeemOrchestrator';
import type { MeshInboundEvent, MeshTransportAdapter } from '../../src/transport/types';

const MY_PUBKEY = `02${'ab'.repeat(32)}`;
const OTHER_PUBKEY = `02${'cd'.repeat(32)}`;
const MINT_URL = 'https://mint.test';
const KEYSET_ID = '009a1f293253e41e';
const PEER = 'deadbeefdeadbeef';

function p2pkSecret(pubkey: string, tags?: string[][]): string {
  return JSON.stringify([
    'P2PK',
    { nonce: '11'.repeat(16), data: pubkey, ...(tags ? { tags } : {}) },
  ]);
}

function proof(secret: string, amount = 2) {
  return { amount, id: KEYSET_ID, secret, C: `02${'ef'.repeat(32)}` };
}

function encode(proofs: ReturnType<typeof proof>[]): string {
  return getEncodedToken({ mint: MINT_URL, proofs, unit: 'sat' });
}

function buildCreq(opts: {
  id?: string;
  mints?: string[];
  lockPubkey?: string;
  unit?: string;
}): string {
  return new PaymentRequest(
    [],
    opts.id ?? 'a1b2c3d4e5f60718',
    undefined,
    opts.unit ?? 'sat',
    opts.mints ?? [MINT_URL],
    undefined,
    true,
    opts.lockPubkey ? { kind: 'P2PK', data: opts.lockPubkey, tags: [] } : undefined
  ).toEncodedRequest();
}

interface FakeAdapter {
  adapter: MeshTransportAdapter;
  emit: (event: MeshInboundEvent) => void;
  statusCalls: Array<[string, string, string, string | undefined]>;
  respondCalls: Array<[string, string, string]>;
}

function createFakeAdapter(): FakeAdapter {
  const listeners = new Set<(event: MeshInboundEvent) => void>();
  const statusCalls: FakeAdapter['statusCalls'] = [];
  const respondCalls: FakeAdapter['respondCalls'] = [];
  return {
    adapter: {
      getPeerCapabilities: () => ({ supportsNutRequests: true, autoRedeem: true }),
      solicitPaymentRequest: vi.fn(async () => {
        throw new Error('not wired');
      }),
      respondToSolicit: async (peerId, solicitId, creq) => {
        respondCalls.push([peerId, solicitId, creq]);
      },
      deliverPayment: async () => {},
      sendPaymentStatus: async (peerId, paymentId, status, reason) => {
        statusCalls.push([peerId, paymentId, status, reason]);
      },
      broadcastBearerToken: async () => {},
      onInbound: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    statusCalls,
    respondCalls,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// classify (port of sovran-app nutDropTokens suite)
// ---------------------------------------------------------------------------

describe('classifyMeshToken', () => {
  it('classifies a token fully locked to my key', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY), 2), proof(p2pkSecret(MY_PUBKEY), 4)]);
    expect(classifyMeshToken(token, MY_PUBKEY)).toEqual({
      classification: 'locked-to-me',
      mintUrl: MINT_URL,
      amount: 6,
      unit: 'sat',
    });
  });

  it('matches the lock key case-insensitively', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY))]);
    expect(classifyMeshToken(token, MY_PUBKEY.toUpperCase()).classification).toBe('locked-to-me');
  });

  it("never classifies the sender's own broadcast echo as locked-to-me", () => {
    const senderEcho = encode([proof(p2pkSecret(OTHER_PUBKEY), 21)]);
    expect(classifyMeshToken(senderEcho, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats mixed locked + bearer proofs as locked-to-other', () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY)), proof('aa'.repeat(32))]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('treats multisig locks as locked-to-other even when my key is included', () => {
    const token = encode([
      proof(
        p2pkSecret(MY_PUBKEY, [
          ['pubkeys', OTHER_PUBKEY],
          ['n_sigs', '2'],
        ])
      ),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe('locked-to-other');
  });

  it('classifies plain-secret tokens as bearer and junk as invalid', () => {
    expect(classifyMeshToken(encode([proof('aa'.repeat(32))]), MY_PUBKEY).classification).toBe(
      'bearer'
    );
    expect(classifyMeshToken('cashuBnotatoken', MY_PUBKEY).classification).toBe('invalid');
    expect(classifyMeshToken('', MY_PUBKEY).classification).toBe('invalid');
  });
});

describe('meshTokenDedupeKey', () => {
  it('is stable for the same token and distinct for different tokens', () => {
    const a = encode([proof(p2pkSecret(MY_PUBKEY))]);
    const b = encode([proof(p2pkSecret(OTHER_PUBKEY))]);
    expect(meshTokenDedupeKey(a)).toBe(meshTokenDedupeKey(a));
    expect(meshTokenDedupeKey(a)).not.toBe(meshTokenDedupeKey(b));
    expect(meshTokenDedupeKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// parse + plan (the safety matrix)
// ---------------------------------------------------------------------------

describe('parseMeshPaymentRequest', () => {
  it('parses a locked single-use request', () => {
    const result = parseMeshPaymentRequest(buildCreq({ lockPubkey: MY_PUBKEY }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.lockPubkey).toBe(MY_PUBKEY);
    expect(result.request.mintUrls).toEqual([normalizeMintUrl(MINT_URL)]);
    expect(result.request.singleUse).toBe(true);
  });

  it('rejects undecodable strings and non-P2PK conditions', () => {
    expect(parseMeshPaymentRequest('creqAnotreal')).toEqual({ ok: false, reason: 'invalid' });
    const weird = new PaymentRequest([], 'id1', undefined, 'sat', [MINT_URL], undefined, true, {
      kind: 'HTLC',
      data: 'aa'.repeat(32),
      tags: [],
    }).toEncodedRequest();
    expect(parseMeshPaymentRequest(weird)).toEqual({ ok: false, reason: 'unsupported-lock' });
  });
});

function solicitOf(creq: string): MeshSolicitOutcome {
  const parsed = parseMeshPaymentRequest(creq);
  if (!parsed.ok) throw new Error('fixture creq failed to parse');
  return { outcome: 'request', request: parsed.request };
}

describe('planMeshSend (safety matrix)', () => {
  const capable = { supportsNutRequests: true, autoRedeem: true };

  it('locked: creq with nut10 + sender online → no consent', () => {
    const plan = planMeshSend({
      capabilities: capable,
      senderOffline: false,
      solicit: solicitOf(buildCreq({ lockPubkey: MY_PUBKEY })),
      localMintUrls: [`${MINT_URL}/`],
    });
    expect(plan).toMatchObject({
      mode: 'locked',
      lockPubkey: MY_PUBKEY,
      consent: 'none',
      allowedMintUrls: [normalizeMintUrl(MINT_URL)],
    });
  });

  it('bearer-dm: creq without nut10 + sender offline → consent required', () => {
    const plan = planMeshSend({
      capabilities: capable,
      senderOffline: true,
      solicit: solicitOf(buildCreq({})),
      localMintUrls: [MINT_URL],
    });
    expect(plan).toMatchObject({ mode: 'bearer-dm', consent: 'bearer' });
  });

  it('aborts with both mint lists when the overlap is empty', () => {
    const plan = planMeshSend({
      capabilities: capable,
      senderOffline: false,
      solicit: solicitOf(buildCreq({ lockPubkey: MY_PUBKEY, mints: ['https://their.mint'] })),
      localMintUrls: ['https://our.mint'],
    });
    expect(plan).toMatchObject({
      mode: 'abort',
      reason: 'no-mint-overlap',
      theirMintUrls: ['https://their.mint'],
      ourMintUrls: ['https://our.mint'],
    });
  });

  it('empty allowlist in the creq means any of our mints', () => {
    const plan = planMeshSend({
      capabilities: capable,
      senderOffline: false,
      solicit: solicitOf(buildCreq({ lockPubkey: MY_PUBKEY, mints: [] })),
      localMintUrls: ['https://our.mint'],
    });
    expect(plan).toMatchObject({ mode: 'locked', allowedMintUrls: ['https://our.mint'] });
  });

  it('aborts on solicit timeout — never a downgraded yes', () => {
    expect(
      planMeshSend({
        capabilities: capable,
        senderOffline: false,
        solicit: { outcome: 'timeout' },
        localMintUrls: [MINT_URL],
      })
    ).toEqual({ mode: 'abort', reason: 'solicit-timeout' });
  });

  it('aborts when online send gets no lock, and when offline send gets one', () => {
    expect(
      planMeshSend({
        capabilities: capable,
        senderOffline: false,
        solicit: solicitOf(buildCreq({})),
        localMintUrls: [MINT_URL],
      })
    ).toMatchObject({ mode: 'abort', reason: 'missing-lock' });
    expect(
      planMeshSend({
        capabilities: capable,
        senderOffline: true,
        solicit: solicitOf(buildCreq({ lockPubkey: MY_PUBKEY })),
        localMintUrls: [MINT_URL],
      })
    ).toMatchObject({ mode: 'abort', reason: 'unexpected-lock' });
  });

  it('routes vanilla peers (no beacon) to the public-broadcast consent path', () => {
    expect(
      planMeshSend({
        capabilities: null,
        senderOffline: false,
        solicit: { outcome: 'timeout' },
        localMintUrls: [MINT_URL],
      })
    ).toEqual({ mode: 'vanilla-broadcast', consent: 'public-broadcast' });
  });
});

// ---------------------------------------------------------------------------
// responder
// ---------------------------------------------------------------------------

function createResponder(fake: FakeAdapter, opts?: { key?: string | null; now?: () => number }) {
  return createMeshRequestResponder({
    adapter: fake.adapter,
    getP2pkReceiveKey: () => (opts && 'key' in opts ? (opts.key ?? null) : MY_PUBKEY),
    getTrustedMintUrls: async () => [MINT_URL],
    now: opts?.now,
  });
}

describe('createMeshRequestResponder', () => {
  it('answers an online solicit with a locked single-use creq and tracks it', async () => {
    const fake = createFakeAdapter();
    const responder = createResponder(fake);
    const stop = responder.start();
    fake.emit({ kind: 'solicit', peerId: PEER, solicitId: '0102030405060708', senderOffline: false });
    await flush();

    expect(fake.respondCalls).toHaveLength(1);
    const [peerId, solicitId, creq] = fake.respondCalls[0]!;
    expect([peerId, solicitId]).toEqual([PEER, '0102030405060708']);
    const parsed = parseMeshPaymentRequest(creq);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.lockPubkey).toBe(MY_PUBKEY);
    expect(responder.getOutstanding(parsed.request.paymentId)?.peerId).toBe(PEER);
    stop();
  });

  it('answers a sender-offline solicit with a bearer creq', async () => {
    const fake = createFakeAdapter();
    const responder = createResponder(fake);
    const stop = responder.start();
    fake.emit({ kind: 'solicit', peerId: PEER, solicitId: 'aa', senderOffline: true });
    await flush();
    const parsed = parseMeshPaymentRequest(fake.respondCalls[0]![2]);
    expect(parsed.ok && parsed.request.lockPubkey).toBe(null);
    stop();
  });

  it('stays silent on online solicits when no receive key is available', async () => {
    const fake = createFakeAdapter();
    const responder = createResponder(fake, { key: null });
    const stop = responder.start();
    fake.emit({ kind: 'solicit', peerId: PEER, solicitId: 'aa', senderOffline: false });
    await flush();
    expect(fake.respondCalls).toHaveLength(0);
    stop();
  });

  it('consume is single-use and expiry reaps requests', async () => {
    let clock = 1_000;
    const fake = createFakeAdapter();
    const responder = createResponder(fake, { now: () => clock });
    const stop = responder.start();
    fake.emit({ kind: 'solicit', peerId: PEER, solicitId: 'aa', senderOffline: false });
    await flush();
    const parsed = parseMeshPaymentRequest(fake.respondCalls[0]![2]);
    if (!parsed.ok) throw new Error('fixture');
    const id = parsed.request.paymentId;

    expect(responder.consume(id)?.paymentId).toBe(id);
    expect(responder.consume(id)).toBeNull();
    expect(responder.getOutstanding(id)).toBeNull();
    expect(responder.peek(id)?.consumed).toBe(true);

    fake.emit({ kind: 'solicit', peerId: PEER, solicitId: 'bb', senderOffline: false });
    await flush();
    const second = parseMeshPaymentRequest(fake.respondCalls[1]![2]);
    if (!second.ok) throw new Error('fixture');
    clock += 120_001;
    expect(responder.getOutstanding(second.request.paymentId)).toBeNull();
    stop();
  });
});

// ---------------------------------------------------------------------------
// inbound payment validation + intake
// ---------------------------------------------------------------------------

async function issuedRequest(fake: FakeAdapter, senderOffline = false) {
  const responder = createResponder(fake);
  const stop = responder.start();
  fake.emit({ kind: 'solicit', peerId: PEER, solicitId: 'aa', senderOffline });
  await flush();
  stop();
  const parsed = parseMeshPaymentRequest(fake.respondCalls[fake.respondCalls.length - 1]![2]);
  if (!parsed.ok) throw new Error('fixture');
  return { responder, paymentId: parsed.request.paymentId };
}

function paymentJson(paymentId: string, opts?: { mint?: string; locked?: boolean }) {
  return JSON.stringify({
    id: paymentId,
    mint: opts?.mint ?? MINT_URL,
    unit: 'sat',
    proofs: [proof(opts?.locked === false ? 'aa'.repeat(32) : p2pkSecret(MY_PUBKEY), 4)],
  });
}

describe('validateInboundMeshPayment', () => {
  it('accepts a locked payment matching the issued request', async () => {
    const fake = createFakeAdapter();
    const { responder, paymentId } = await issuedRequest(fake);
    const result = validateInboundMeshPayment(paymentJson(paymentId), responder, PEER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.amount).toBe(4);
    expect(result.payment.mintUrl).toBe(MINT_URL);
    // Single-use: the same payment again is now a duplicate.
    expect(validateInboundMeshPayment(paymentJson(paymentId), responder, PEER)).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('accepts bearer proofs only for bearer requests', async () => {
    const fake = createFakeAdapter();
    const { responder, paymentId } = await issuedRequest(fake, true);
    expect(
      validateInboundMeshPayment(paymentJson(paymentId, { locked: false }), responder, PEER).ok
    ).toBe(true);
  });

  it('rejects unknown ids, foreign peers, untrusted mints, and lock mismatches', async () => {
    const fake = createFakeAdapter();
    const { responder, paymentId } = await issuedRequest(fake);
    expect(validateInboundMeshPayment(paymentJson('feedfeedfeedfeed'), responder, PEER)).toMatchObject(
      { ok: false, reason: 'mismatch' }
    );
    expect(
      validateInboundMeshPayment(paymentJson(paymentId), responder, 'cafecafecafecafe')
    ).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(
      validateInboundMeshPayment(
        paymentJson(paymentId, { mint: 'https://evil.mint' }),
        responder,
        PEER
      )
    ).toMatchObject({ ok: false, reason: 'untrustedMint' });
    expect(
      validateInboundMeshPayment(paymentJson(paymentId, { locked: false }), responder, PEER)
    ).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(validateInboundMeshPayment('not json', responder, PEER)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    // None of the rejections burned the single-use request.
    expect(responder.getOutstanding(paymentId)).not.toBeNull();
  });
});

describe('createMeshPaymentIntake', () => {
  it('enqueues accepted payments and acks received; rejects with reasons', async () => {
    const fake = createFakeAdapter();
    const { responder, paymentId } = await issuedRequest(fake);
    const enqueued: string[] = [];
    const accepted: string[] = [];
    const intake = createMeshPaymentIntake({
      adapter: fake.adapter,
      responder,
      queue: {
        entries: () => ({}),
        enqueue: (hash) => {
          const fresh = !enqueued.includes(hash);
          enqueued.push(hash);
          return fresh;
        },
      },
      onAccepted: (hash) => accepted.push(hash),
    });
    const stop = intake.start();

    fake.emit({ kind: 'payment', peerId: PEER, payloadJson: paymentJson(paymentId) });
    await flush();
    expect(enqueued).toHaveLength(1);
    expect(accepted).toHaveLength(1);
    expect(fake.statusCalls).toContainEqual([PEER, paymentId, 'received', undefined]);

    fake.emit({ kind: 'payment', peerId: PEER, payloadJson: paymentJson('0000000000000000') });
    await flush();
    expect(fake.statusCalls).toContainEqual([PEER, '0000000000000000', 'rejected', 'mismatch']);
    expect(accepted).toHaveLength(1);
    stop();
  });
});

// ---------------------------------------------------------------------------
// delivery tracker
// ---------------------------------------------------------------------------

describe('createMeshDeliveryTracker', () => {
  it('advances delivered → received → redeemed and ignores foreign peers', () => {
    const fake = createFakeAdapter();
    const tracker = createMeshDeliveryTracker({ adapter: fake.adapter });
    const states: string[] = [];
    tracker.subscribe((update) => states.push(update.state));
    tracker.track('pid1', PEER);

    fake.emit({ kind: 'status', peerId: 'cafecafecafecafe', status: 'received', reason: 'none', paymentId: 'pid1' });
    expect(tracker.getState('pid1')).toBe('delivered');

    fake.emit({ kind: 'status', peerId: PEER, status: 'received', reason: 'none', paymentId: 'pid1' });
    fake.emit({ kind: 'status', peerId: PEER, status: 'redeemed', reason: 'none', paymentId: 'pid1' });
    // Late/duplicate received must not regress the redeemed state.
    fake.emit({ kind: 'status', peerId: PEER, status: 'received', reason: 'none', paymentId: 'pid1' });
    expect(tracker.getState('pid1')).toBe('redeemed');
    expect(states).toEqual(['delivered', 'received', 'redeemed']);
    tracker.dispose();
  });

  it('flags unconfirmed on timeout but still accepts late statuses', () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeAdapter();
      const tracker = createMeshDeliveryTracker({ adapter: fake.adapter, receivedTimeoutMs: 1000 });
      tracker.track('pid1', PEER);
      vi.advanceTimersByTime(1001);
      expect(tracker.getState('pid1')).toBe('unconfirmed');
      fake.emit({ kind: 'status', peerId: PEER, status: 'rejected', reason: 'untrustedMint', paymentId: 'pid1' });
      expect(tracker.getState('pid1')).toBe('rejected');
      tracker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// redeem orchestrator
// ---------------------------------------------------------------------------

function entry(overrides: Partial<MeshRedeemEntry> = {}): MeshRedeemEntry {
  return {
    token: 'cashuB...',
    mintUrl: MINT_URL,
    amount: 21,
    unit: 'sat',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    receivedAt: 0,
    ...overrides,
  };
}

function createQueue(initial: Record<string, MeshRedeemEntry>) {
  const statuses: Array<[string, string]> = [];
  const retries: string[] = [];
  return {
    port: {
      prune: () => {},
      entries: () => initial,
      markStatus: (hash: string, status: string) => statuses.push([hash, status]),
      scheduleRetry: (hash: string) => retries.push(hash),
    },
    statuses,
    retries,
  };
}

function fakeManager(trusted = true) {
  // Stable identity: the orchestrator aborts a drain if getManager() returns
  // a different object mid-drain (profile-switch guard).
  const manager = { mint: { isTrustedMint: async () => trusted } } as never;
  return () => manager;
}

describe('createMeshRedeemOrchestrator', () => {
  it('redeems due trusted entries through executeAutoRedeem', async () => {
    const queue = createQueue({ h1: entry() });
    const redeemed: string[] = [];
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async (token) => {
        redeemed.push(token);
        return { historyEntryId: 'hist1' };
      },
      onRedeemed: (hash, _entry, historyEntryId) => {
        expect([hash, historyEntryId]).toEqual(['h1', 'hist1']);
      },
    });
    await orchestrator.drain();
    expect(redeemed).toEqual(['cashuB...']);
    expect(queue.statuses).toEqual([
      ['h1', 'redeeming'],
      ['h1', 'redeemed'],
    ]);
  });

  it('parks untrusted-mint entries without touching the wallet', async () => {
    const queue = createQueue({ h1: entry() });
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(false),
      queue: queue.port,
      executeAutoRedeem: async () => {
        throw new Error('must not be called');
      },
    });
    await orchestrator.drain();
    expect(queue.statuses).toEqual([['h1', 'untrusted-mint']]);
  });

  it('classifies errors: spent terminal, network retried, fatal failed', async () => {
    const queue = createQueue({
      spent: entry(),
      net: entry(),
      fatal: entry(),
    });
    const errors: Record<string, Error> = {
      spent: new Error('Token was already spent'),
      net: new Error('fetch failed: network down'),
      fatal: new Error('proof verification failed'),
    };
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async (token) => {
        throw errors[token as keyof typeof errors] ?? new Error('unknown');
      },
    });
    // Tokens double as keys for the fixture.
    queue.port.entries = () => ({
      spent: entry({ token: 'spent' }),
      net: entry({ token: 'net' }),
      fatal: entry({ token: 'fatal' }),
    });
    await orchestrator.drain();
    expect(queue.statuses).toContainEqual(['spent', 'spent']);
    expect(queue.retries).toEqual(['net']);
    expect(queue.statuses).toContainEqual(['fatal', 'failed']);
  });

  it('gates on manager availability, restore status, and backoff windows', async () => {
    const queue = createQueue({ h1: entry({ nextAttemptAt: Number.MAX_SAFE_INTEGER }) });
    const execute = vi.fn(async () => ({ historyEntryId: null }));

    const noManager = createMeshRedeemOrchestrator({
      getManager: () => null,
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await noManager.drain();

    const restoring = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
      isRestoreSettled: () => false,
    });
    await restoring.drain();

    const backoff = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await backoff.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(queue.statuses).toEqual([]);
  });
});

describe('classifyMeshRedeemError', () => {
  it('maps message patterns to kinds', () => {
    expect(classifyMeshRedeemError(new Error('Token already   spent'))).toBe('spent');
    expect(classifyMeshRedeemError(new Error('request timed out'))).toBe('network');
    expect(classifyMeshRedeemError(new Error('key pair not found for keyset'))).toBe('retryable');
    expect(classifyMeshRedeemError(new Error('bad signature'))).toBe('fatal');
  });
});
