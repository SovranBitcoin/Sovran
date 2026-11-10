/** @jest-environment node */
import type { AppStateStatus } from 'react-native';
import { Amount, createBlindSignature, deriveKeysetId, pointFromHex } from '@cashu/cashu-ts';
import { initializeCoco, MemoryRepositories, type Manager } from '@cashu/coco-core';
import type { Plugin } from '@cashu/coco-core/plugin';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';

/**
 * What a payer on the released 0.1.3 sends to a receive request made by this
 * build, fed through the Nostr transport into the installed Coco.
 *
 * The transport, Coco's receive service and its in-memory repositories are
 * real; so is the request (made by `incoming.create` through this transport).
 * Faked: the mint (one synthetic keyset that signs every swap, as in
 * wallet/__tests__/integration/nearby-dual-transport.test.ts), the inbox read
 * (a data layer handing back fixed wraps) and the NIP-17 unwrap (the cache
 * hands back the rumor each wrap carries).
 */

type PluginContext = Parameters<NonNullable<Plugin['onInit']>>[0];
type ReceiveService = PluginContext['services']['paymentRequestReceiveService'];
type Envelope = { id: string; kind: number; pubkey: string; content: string; createdAtSec: number };

const MINT = 'https://released-payer.test';
const MINT_KEY = new Uint8Array(32);
MINT_KEY[31] = 1;
const PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const KEYPAIRS = Object.fromEntries([1, 2, 4, 8, 16].map((amount) => [String(amount), PUBLIC_KEY]));
const KEYSET = deriveKeysetId(KEYPAIRS, { unit: 'sat', input_fee_ppk: 0 });

const mockRumors = new Map<string, string>();
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: {
    unwrap: (_viewer: string, envelope: { id: string }) => {
      const content = mockRumors.get(envelope.id);
      return content === undefined ? null : { content, senderPubkey: 'c'.repeat(64) };
    },
    cache: { hydrate: async () => undefined },
  },
}));

function wrap(id: string, rumor: string): Envelope {
  mockRumors.set(id.repeat(64), rumor);
  return {
    id: id.repeat(64),
    kind: 1059,
    pubkey: 'b'.repeat(64),
    content: 'wrapped',
    createdAtSec: 1,
  };
}

async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn++) await new Promise((resolve) => setImmediate(resolve));
}

async function until(what: string, condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`${what} did not happen`);
}

interface Ingested {
  payload: { id: string; proofs: { amount: unknown }[] };
  transportMessageId: string | undefined;
  outcome: string;
}

async function setup() {
  const repo = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  await repo.mintRepository.addNewMint({
    mintUrl: MINT,
    name: 'Synthetic mint',
    trusted: true,
    createdAt: now,
    updatedAt: now,
    mintInfo: {
      name: 'Synthetic mint',
      contact: [],
      pubkey: PUBLIC_KEY,
      version: 'test',
      nuts: { '4': { methods: [], disabled: false }, '5': { methods: [], disabled: false } },
    },
  });
  await repo.keysetRepository.addKeyset({
    mintUrl: MINT,
    id: KEYSET,
    unit: 'sat',
    keypairs: KEYPAIRS,
    active: true,
    feePpk: 0,
  });
  const swaps = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/v1/swap'))
      throw new Error(`Unexpected mint request: ${String(url)}`);
    const body = JSON.parse(String(init?.body)) as { outputs: { amount: number; B_: string }[] };
    const signatures = body.outputs.map((output) => ({
      id: KEYSET,
      amount: output.amount,
      C_: createBlindSignature(pointFromHex(output.B_), MINT_KEY, KEYSET).C_.toHex(true),
    }));
    return new Response(JSON.stringify({ signatures }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  let inbox: Envelope[] = [];
  const getDmEnvelopes = jest.fn(async () => ({
    match: (ok: (value: { envelopes: Envelope[] }) => unknown) => ok({ envelopes: inbox }),
  }));
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    currentState: 'active' as AppStateStatus,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const setAppState = (state: AppStateStatus) => {
    appState.currentState = state;
    for (const listener of [...listeners]) listener(state);
  };

  let service: ReceiveService | undefined;
  const capture: Plugin = {
    name: 'capture-receive-service',
    required: ['paymentRequestReceiveService'] as const,
    onInit(ctx) {
      service = ctx.services.paymentRequestReceiveService;
    },
  };
  const layer = { getDmEnvelopes, subscribeDmEnvelopes: () => () => undefined };
  const manager: Manager = await initializeCoco({
    repo,
    seedGetter: async () => new Uint8Array(64).fill(7),
    plugins: [
      capture,
      createPaymentRequestNostrTransportPlugin({
        getSignerKey: () => new Uint8Array(32).fill(1),
        loadDataLayer: async () => layer as never,
        appState,
      }),
    ],
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
      meltQuoteWatcher: { disabled: true },
    },
    processors: {
      mintOperationProcessor: { disabled: true },
      meltSettlementProcessor: { disabled: true },
    },
  });

  // Every payload the transport hands to Coco, with what Coco made of it.
  const ingested: Ingested[] = [];
  const receive = service!;
  const original = receive.ingestPayload.bind(receive);
  jest.spyOn(receive, 'ingestPayload').mockImplementation(async (content, source) => {
    const record: Ingested = {
      payload: JSON.parse(String(content)) as Ingested['payload'],
      transportMessageId: source?.transportMessageId,
      outcome: 'pending',
    };
    ingested.push(record);
    try {
      const result = await original(content, source);
      record.outcome = result.attempt.state;
      return result;
    } catch (error) {
      record.outcome = error instanceof Error ? error.message : String(error);
      throw error;
    }
  });

  return {
    manager,
    ingested,
    swaps,
    getDmEnvelopes,
    setInbox: (envelopes: Envelope[]) => {
      inbox = envelopes;
    },
    /**
     * A standing request, as the receive hub keeps one: it stays active after a
     * claim. Returns once the poll its activation starts has read the empty inbox.
     */
    createRequest: async () => {
      const request = await manager.paymentRequests.incoming.create({
        amount: 8,
        unit: 'sat',
        mints: [MINT],
        singleUse: false,
        transport: 'nostr',
        encoding: 'creqA',
      });
      await until('the first poll', () => getDmEnvelopes.mock.calls.length > 0);
      await turns(50);
      return request;
    },
    /** Back from the background: the transport polls at once. */
    pollAgain: async () => {
      const before = getDmEnvelopes.mock.calls.length;
      setAppState('background');
      setAppState('active');
      await until('the next poll', () => getDmEnvelopes.mock.calls.length > before);
      await until('the poll to settle', () => ingested.every((each) => each.outcome !== 'pending'));
      await turns(50);
    },
    dispose: async () => {
      await manager.dispose();
      swaps.mockRestore();
    },
  };
}

describe('a NUT-18 payment over Nostr into this build', () => {
  const quieted: jest.SpyInstance[] = [];
  beforeEach(() => {
    mockRumors.clear();
    // The logger prints every entry.
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      quieted.push(jest.spyOn(console, method).mockImplementation(() => {}));
    }
  });
  afterEach(() => quieted.splice(0).forEach((spy) => spy.mockRestore()));

  it('hands a 0.1.3 payer’s payload to Coco unchanged, is refused, and offers it again on the next poll', async () => {
    const t = await setup();
    try {
      const request = await t.createRequest();
      expect(request.encodedRequest.startsWith('creqA')).toBe(true);
      // wallet/src/operations/defaultOperations.ts:1821-1831@d9ad12c4b:
      // `{ id: paymentRequest, mint: mintUrl, unit, proofs: token.proofs }`, where
      // `paymentRequest` is the whole encoded request and each proof's amount is a
      // cashu-ts `Amount`, which serialises as a string.
      const released = JSON.stringify({
        id: request.encodedRequest,
        mint: MINT,
        unit: 'sat',
        proofs: [{ id: KEYSET, amount: Amount.from(8), secret: 'released-input', C: PUBLIC_KEY }],
      });
      expect(released).toContain('"amount":"8"');
      t.setInbox([wrap('a', released)]);
      await t.pollAgain();
      expect(t.ingested).toHaveLength(1);

      expect(t.ingested[0].payload.id).toBe(request.encodedRequest);
      expect(t.ingested[0].payload.proofs[0].amount).toBe('8');
      expect(t.ingested[0].transportMessageId).toBe('a'.repeat(64));
      // QUIRK: Coco looks the request up by the payload's `id`, which a 0.1.3
      // payer sets to the whole encoded request, so a payment the request asked
      // for is refused and the payer's proofs stay in its pending send.
      expect(t.ingested[0].outcome).toBe(
        `No active payment request found for id ${request.encodedRequest}`
      );

      await t.pollAgain();
      expect(t.ingested).toHaveLength(2);
      // QUIRK: the refusal is treated as retryable, so the same wrap is unwrapped
      // and refused again on every poll while it is in the read window.
      expect(t.ingested[1].transportMessageId).toBe('a'.repeat(64));
      expect(t.ingested[1].outcome).toBe(t.ingested[0].outcome);
      expect(t.swaps).not.toHaveBeenCalled();
    } finally {
      await t.dispose();
    }
  });

  it('claims a payload shaped as this build sends it once, and does not offer it again', async () => {
    const t = await setup();
    try {
      const request = await t.createRequest();
      // wallet/src/operations/defaultOperations.ts (HEAD): `id: info.requestId`, numeric amounts.
      const current = JSON.stringify({
        id: request.requestId,
        mint: MINT,
        unit: 'sat',
        proofs: [{ id: KEYSET, amount: 8, secret: 'current-input', C: PUBLIC_KEY }],
      });
      t.setInbox([wrap('d', current)]);
      await t.pollAgain();
      expect(t.ingested).toHaveLength(1);

      expect(t.ingested[0].payload.id).toBe(request.requestId);
      expect(t.ingested[0].outcome).toBe('finalized');
      expect(t.swaps).toHaveBeenCalledTimes(1);

      await t.pollAgain();
      await t.pollAgain();
      // Both polls read the wrap again; neither hands it to Coco.
      expect(t.ingested).toHaveLength(1);
      expect(t.swaps).toHaveBeenCalledTimes(1);
    } finally {
      await t.dispose();
    }
  });
});
