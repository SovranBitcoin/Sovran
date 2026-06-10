/**
 * NIP-46 engine over an in-memory fake transport and the REAL Layer-1 stores
 * (reset between tests). Load-bearing cases: the full pipeline's auto-allow /
 * auto-deny / ask verdicts with activity + usage writes; stranger silent
 * drop; bunker consume-then-ack ordering (a failing consume never acks);
 * duplicate connect ack; envelope + rpc-id dedupe; created_at skew and forged
 * signature rejection; enqueue-overflow → "rate limited"; resolveRequest's
 * five actions including grant persistence and the critical ceiling; the
 * session-grant flow (and its self-decrypt refusal); the expiry sweep; the
 * nostrconnect secret echo; and per-peer encryption re-pinning.
 */

/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class MockNDK {},
    NDKPrivateKeySigner: class MockPrivateKeySigner {},
    NDKUser: class MockUser {
      pubkey: string;
      constructor(params: { pubkey: string }) {
        this.pubkey = params.pubkey;
      }
    },
    // virtual: ndk-mobile ships ESM-only exports jest-expo cannot resolve.
  }),
  { virtual: true }
);

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => ({
    name: 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const map = new Map<string, string>();
  return {
    createProfileScopedStorage: () => ({
      getItem: (key: string) => Promise.resolve(map.get(key) ?? null),
      setItem: (key: string, value: string) => {
        map.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        map.delete(key);
        return Promise.resolve();
      },
    }),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

import type { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk-mobile';
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow';

import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import type { BunkerSecretsError } from '@/features/nostrSigner/lib/bunkerSecrets';
import {
  createNip46Engine,
  EXPIRY_SWEEP_INTERVAL_MS,
  type Nip46Engine,
  type Nip46EngineDeps,
} from '@/features/nostrSigner/lib/nip46Engine';
import type { Nip46Encryption } from '@/features/nostrSigner/lib/nip46Transport';
import {
  MAX_PENDING_PER_APP,
  NIP46_ERRORS,
  REQUEST_TTL_MS,
  type RpcResponse,
} from '@/features/nostrSigner/lib/nip46Types';
import type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';

const USER = 'f'.repeat(64);
const APP = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);
const PEER = 'c'.repeat(64);
const T0 = 1_700_000_000_000;
const DEFAULT_RELAYS = ['wss://relay.damus.io'];

let now = T0;
const nowSec = () => Math.floor(now / 1000);

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ── Fakes ───────────────────────────────────────────────────────

interface SentResponse {
  toPubkey: string;
  payloadJson: string;
  encryption: Nip46Encryption;
}

function makeFakeTransport() {
  const sent: SentResponse[] = [];
  let onEvent: ((event: NDKEvent) => void) | null = null;
  const overrides: { decryptUsed: Nip46Encryption | null; failDecrypt: boolean } = {
    decryptUsed: null,
    failDecrypt: false,
  };
  const transport = {
    isStarted: false,
    lastEventReceivedAt: null as number | null,
    start: jest.fn((params: { onEvent: (event: NDKEvent) => void }) => {
      onEvent = params.onEvent;
      transport.isStarted = true;
      return ok<void, never>(undefined);
    }),
    rebuild: jest.fn(() => ok<void, never>(undefined)),
    reconnect: jest.fn(() => ok<void, never>(undefined)),
    stop: jest.fn(() => {
      transport.isStarted = false;
      return ok<void, never>(undefined);
    }),
    decryptEnvelope: jest.fn((_sender: string, content: string, pinned: Nip46Encryption) =>
      overrides.failDecrypt
        ? errAsync({ type: 'decrypt-failed' as const, cause: { name: 'E', message: 'nope' } })
        : okAsync({ plaintext: content, used: overrides.decryptUsed ?? pinned })
    ),
    sendResponse: jest.fn((params: SentResponse) => {
      sent.push(params);
      return okAsync<void, never>(undefined);
    }),
  };
  return {
    transport,
    sent,
    overrides,
    emit: (event: NDKEvent) => {
      if (!onEvent) throw new Error('transport not started');
      onEvent(event);
    },
  };
}

const fakeSigner = {
  sign: jest.fn(async () => 'f'.repeat(128)),
  nip04Encrypt: jest.fn(async () => 'ct04'),
  nip04Decrypt: jest.fn(async () => 'pt04'),
  nip44Encrypt: jest.fn(async () => 'ct44'),
  nip44Decrypt: jest.fn(async () => 'pt44'),
} as unknown as NDKPrivateKeySigner;

let eventSeq = 0;

interface MakeEventOptions {
  from?: string;
  createdAt?: number;
  id?: string;
  validSig?: boolean;
}

function makeEvent(payload: unknown, options: MakeEventOptions = {}): NDKEvent {
  eventSeq += 1;
  return {
    id: options.id ?? eventSeq.toString(16).padStart(64, '0'),
    pubkey: options.from ?? APP,
    created_at: options.createdAt ?? nowSec(),
    kind: 24133,
    content: JSON.stringify(payload),
    tags: [['p', USER]],
    verifySignature: jest.fn(() => options.validSig ?? true),
  } as unknown as NDKEvent;
}

let rpcSeq = 0;
function rpc(
  method: string,
  params: string[] = []
): { id: string; method: string; params: string[] } {
  rpcSeq += 1;
  return { id: `rpc-${rpcSeq}`, method, params };
}

function signEventParams(overrides: Partial<Record<string, unknown>> = {}): string[] {
  return [
    JSON.stringify({
      kind: 1,
      content: 'hello from a client app',
      tags: [],
      created_at: nowSec(),
      ...overrides,
    }),
  ];
}

interface EngineHarness {
  engine: Nip46Engine;
  transport: ReturnType<typeof makeFakeTransport>['transport'];
  sent: SentResponse[];
  overrides: ReturnType<typeof makeFakeTransport>['overrides'];
  emit: (event: NDKEvent) => void;
  rateLimiter: { take: jest.Mock; isThrottled: jest.Mock; cooldownUntil: jest.Mock };
  consumeSecret: jest.Mock;
  hasOutstandingSecret: jest.Mock;
}

/** Engines created in the current test — stopped in afterEach so no sweep interval leaks. */
const createdEngines: Nip46Engine[] = [];

function makeEngine(deps: Partial<Nip46EngineDeps> = {}, autoStart = true): EngineHarness {
  const fake = makeFakeTransport();
  const rateLimiter = {
    take: jest.fn(() => ({ allowed: true, throttled: false })),
    isThrottled: jest.fn(() => false),
    cooldownUntil: jest.fn(() => null),
  };
  const consumeSecret = jest.fn(() => okAsync<boolean, BunkerSecretsError>(false));
  const hasOutstandingSecret = jest.fn(() => okAsync<boolean, BunkerSecretsError>(false));
  const engine = createNip46Engine({
    transport: fake.transport,
    rateLimiter,
    consumeSecret,
    hasOutstandingSecret,
    defaultRelays: DEFAULT_RELAYS,
    now: () => now,
    mintRpcId: () => 'minted-id',
    ...deps,
  });
  createdEngines.push(engine);
  if (autoStart) {
    expect(engine.start({ signer: fakeSigner, userPubkey: USER }).isOk()).toBe(true);
  }
  return {
    engine,
    transport: fake.transport,
    sent: fake.sent,
    overrides: fake.overrides,
    emit: fake.emit,
    rateLimiter,
    consumeSecret,
    hasOutstandingSecret,
  };
}

function pairApp(clientPubkey = APP, relays = DEFAULT_RELAYS): void {
  const result = useNip46ConnectionsStore.getState().upsertApp({
    clientPubkey,
    relays: [...relays],
    origin: 'bunker',
  });
  expect(result.isOk()).toBe(true);
}

function parsedResponse(entry: SentResponse): RpcResponse {
  return JSON.parse(entry.payloadJson) as RpcResponse;
}

function activityEntries() {
  return useNip46ActivityStore.getState().entries;
}

function connectionFor(pubkey: string) {
  return useNip46ConnectionsStore.getState().apps[pubkey];
}

function nostrconnectUri(overrides: Partial<ParsedNostrConnectUri> = {}): ParsedNostrConnectUri {
  return {
    type: 'nostrconnect',
    clientPubkey: APP_B,
    relays: ['wss://client.relay.example'],
    secret: 'client-secret-token',
    name: 'Primal',
    perms: [],
    ...overrides,
  };
}

beforeEach(() => {
  now = T0;
  jest.clearAllMocks();
  useNip46ConnectionsStore.setState({ apps: {} });
  useNip46RequestsStore.setState({ pending: [], sessionGrants: [], throttledApps: {} });
  useNip46ActivityStore.setState({ entries: [] });
});

afterEach(() => {
  for (const engine of createdEngines.splice(0)) engine.stop();
  jest.useRealTimers();
});

// ── Pipeline: auto verdicts ─────────────────────────────────────

describe('pipeline auto verdicts', () => {
  it('auto-allows get_public_key from a paired app and logs it', async () => {
    pairApp();
    const { emit, sent } = makeEngine();

    const request = rpc('get_public_key');
    emit(makeEvent(request));
    await flush();

    expect(sent).toHaveLength(1);
    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, result: USER });
    expect(sent[0]!.toPubkey).toBe(APP);
    expect(activityEntries()).toMatchObject([
      { clientPubkey: APP, method: 'get_public_key', verdict: 'auto_approved_method' },
    ]);
    expect(connectionFor(APP)?.requestCount).toBe(1);
  });

  it('auto-allows sign_event under an always grant: signs, logs summary + grant use', async () => {
    pairApp();
    expect(useNip46ConnectionsStore.getState().setGrant(APP, 'sign_event:1', 'always').isOk()).toBe(
      true
    );
    const { emit, sent } = makeEngine();

    const request = rpc('sign_event', signEventParams());
    emit(makeEvent(request));
    await flush();

    expect(sent).toHaveLength(1);
    const response = parsedResponse(sent[0]!);
    expect(response.id).toBe(request.id);
    const signed = JSON.parse(response.result!) as { kind: number; sig: string; id: string };
    expect(signed.kind).toBe(1);
    expect(signed.sig).toBe('f'.repeat(128));
    expect(activityEntries()).toMatchObject([
      {
        method: 'sign_event',
        kind: 1,
        verdict: 'auto_approved_grant',
        contentPreview: 'hello from a client app',
        eventId: signed.id,
      },
    ]);
    expect(connectionFor(APP)?.grants['sign_event:1']?.useCount).toBe(1);
  });

  it('auto-denies under a deny grant with "Not authorized"', async () => {
    pairApp();
    useNip46ConnectionsStore.getState().setGrant(APP, 'sign_event:1', 'deny');
    const { emit, sent } = makeEngine();

    const request = rpc('sign_event', signEventParams());
    emit(makeEvent(request));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({
      id: request.id,
      error: NIP46_ERRORS.notAuthorized,
    });
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_grant', kind: 1 }]);
    expect(connectionFor(APP)?.deniedCount).toBe(1);
  });

  it('answers "rate limited" when the limiter denies, and flags throttled apps', async () => {
    pairApp();
    const { emit, sent, rateLimiter } = makeEngine();
    rateLimiter.take.mockReturnValue({ allowed: false, throttled: true, cooldownUntil: now + 1 });

    const request = rpc('sign_event', signEventParams());
    emit(makeEvent(request));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, error: NIP46_ERRORS.rateLimited });
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_rate_limited' }]);
    expect(useNip46RequestsStore.getState().throttledApps[APP]).toBe(now + 1); // cooldownUntil
  });

  it('answers "malformed request" for an unparseable sign_event payload', async () => {
    pairApp();
    const { emit, sent } = makeEngine();

    const request = rpc('sign_event', ['{not json']);
    emit(makeEvent(request));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({
      id: request.id,
      error: NIP46_ERRORS.malformedRequest,
    });
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_malformed' }]);
  });

  it('silently denies a blocked app with only an activity row', async () => {
    pairApp();
    useNip46ConnectionsStore.getState().blockApp(APP);
    const { emit, sent } = makeEngine();

    emit(makeEvent(rpc('get_public_key')));
    await flush();

    expect(sent).toHaveLength(0);
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_blocked' }]);
  });

  it('keeps blocked apps silent even for malformed payloads', async () => {
    pairApp();
    useNip46ConnectionsStore.getState().blockApp(APP);
    const { emit, sent } = makeEngine();

    emit(makeEvent(rpc('sign_event', ['{not json'])));
    await flush();

    expect(sent).toHaveLength(0);
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_blocked' }]);
  });

  it('never logs ping activity but still answers pong', async () => {
    pairApp();
    const { emit, sent } = makeEngine();

    const request = rpc('ping');
    emit(makeEvent(request));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, result: 'pong' });
    expect(activityEntries()).toHaveLength(0);
  });
});

// ── Pipeline: gates ─────────────────────────────────────────────

describe('pipeline gates', () => {
  it('silently drops strangers when no secret is outstanding and no pairing awaited', async () => {
    const { emit, sent, transport, hasOutstandingSecret } = makeEngine();

    emit(makeEvent(rpc('get_public_key'), { from: APP_B }));
    await flush();

    expect(hasOutstandingSecret).toHaveBeenCalledWith(USER);
    expect(transport.decryptEnvelope).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(activityEntries()).toHaveLength(0);
  });

  it('drops strangers BEFORE signature verification or rate limiting', async () => {
    const { emit, rateLimiter } = makeEngine();

    const event = makeEvent(rpc('get_public_key'), { from: APP_B });
    emit(event);
    await flush();

    expect(
      (event as unknown as { verifySignature: jest.Mock }).verifySignature
    ).not.toHaveBeenCalled();
    expect(rateLimiter.take).not.toHaveBeenCalled();
  });

  it('drops events with forged signatures before rate limiting and decryption', async () => {
    pairApp();
    const { emit, sent, transport, rateLimiter } = makeEngine();

    emit(makeEvent(rpc('get_public_key'), { validSig: false }));
    await flush();

    expect(rateLimiter.take).not.toHaveBeenCalled();
    expect(transport.decryptEnvelope).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('a spoofed envelope that fails to decrypt never burns the victim app rate budget', async () => {
    // Forged envelope claims a paired app's pubkey and replays a cached id so
    // verifySignature passes, but the ECDH decrypt fails — the rate limiter
    // (and the victim app's budget) must never be touched.
    pairApp();
    const { emit, sent, rateLimiter, overrides } = makeEngine();
    overrides.failDecrypt = true;

    emit(makeEvent(rpc('get_public_key')));
    await flush();

    expect(rateLimiter.take).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(useNip46RequestsStore.getState().throttledApps[APP]).toBeUndefined();
  });

  it('rejects events outside the created_at skew window', async () => {
    pairApp();
    const { emit, transport } = makeEngine();

    emit(makeEvent(rpc('get_public_key'), { createdAt: nowSec() - 301 }));
    emit(makeEvent(rpc('get_public_key'), { createdAt: nowSec() + 301 }));
    await flush();

    expect(transport.decryptEnvelope).not.toHaveBeenCalled();
  });

  it('dedupes by envelope id and by rpc id across fresh envelopes', async () => {
    pairApp();
    const { emit, sent, transport } = makeEngine();

    const request = rpc('get_public_key');
    const event = makeEvent(request);
    emit(event);
    emit(event); // identical envelope replay
    await flush();
    expect(transport.decryptEnvelope).toHaveBeenCalledTimes(1);

    emit(makeEvent(request)); // same rpc id under a fresh envelope id
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('drops non-connect methods from a mid-pairing stranger without responding', async () => {
    const { engine, emit, sent, transport } = makeEngine();
    expect(engine.startNostrconnectPairing(nostrconnectUri()).isOk()).toBe(true);

    emit(makeEvent(rpc('get_public_key'), { from: APP_B }));
    await flush();

    expect(transport.decryptEnvelope).toHaveBeenCalledTimes(1); // gate passed
    expect(sent).toHaveLength(0); // but no service, no response
  });

  it('answers "unsupported method" for an unknown method with a recoverable id', async () => {
    pairApp();
    const { emit, sent } = makeEngine();

    emit(makeEvent({ id: 'weird-1', method: 'mystery_method', params: [] }));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({
      id: 'weird-1',
      error: NIP46_ERRORS.unsupportedMethod,
    });
  });

  it('updates the per-peer encryption pin when the other scheme decrypted', async () => {
    pairApp();
    const { emit, sent, overrides } = makeEngine();
    overrides.decryptUsed = 'nip04';

    const request = rpc('get_public_key');
    emit(makeEvent(request));
    await flush();

    expect(connectionFor(APP)?.encryption).toBe('nip04');
    expect(sent[0]!.encryption).toBe('nip04'); // response speaks what the client speaks
  });
});

// ── Bunker handshake ────────────────────────────────────────────

describe('bunker connect handshake', () => {
  it('acks only AFTER the secret consume write resolves true, then pairs + rebuilds', async () => {
    let resolveConsume: ((value: boolean) => void) | undefined;
    const consumeSecret = jest.fn(() =>
      ResultAsync.fromPromise(
        new Promise<boolean>((resolve) => {
          resolveConsume = resolve;
        }),
        (): BunkerSecretsError => ({
          type: 'storage-read-failed',
          cause: { name: '', message: '' },
        })
      )
    );
    const { emit, sent, transport, hasOutstandingSecret } = makeEngine({ consumeSecret });
    hasOutstandingSecret.mockReturnValue(okAsync(true));

    const request = rpc('connect', [USER, 'the-secret']);
    emit(makeEvent(request, { from: APP_B }));
    await flush();

    expect(consumeSecret).toHaveBeenCalledWith(USER, 'the-secret');
    expect(sent).toHaveLength(0); // no ack before the consume write lands

    resolveConsume!(true);
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, result: 'ack' });
    const connection = connectionFor(APP_B);
    expect(connection).toMatchObject({ origin: 'bunker', status: 'active', mode: 'standard' });
    expect(connection?.grants).toEqual({});
    expect(activityEntries()).toMatchObject([{ method: 'connect', verdict: 'approved_pairing' }]);
    expect(transport.rebuild).toHaveBeenCalled();
  });

  it('NEVER acks when the consume write fails', async () => {
    const consumeSecret = jest.fn(() =>
      errAsync<boolean, BunkerSecretsError>({
        type: 'storage-write-failed',
        cause: { name: 'E', message: 'disk' },
      })
    );
    const { emit, sent, hasOutstandingSecret } = makeEngine({ consumeSecret });
    hasOutstandingSecret.mockReturnValue(okAsync(true));

    emit(makeEvent(rpc('connect', [USER, 'the-secret']), { from: APP_B }));
    await flush();

    expect(sent).toHaveLength(0);
    expect(connectionFor(APP_B)).toBeUndefined();
  });

  it('answers "invalid secret" for an unknown client with a consumed/bad secret', async () => {
    const { emit, sent, hasOutstandingSecret } = makeEngine();
    hasOutstandingSecret.mockReturnValue(okAsync(true)); // consumeSecret default: ok(false)

    const request = rpc('connect', [USER, 'already-used']);
    emit(makeEvent(request, { from: APP_B }));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, error: NIP46_ERRORS.invalidSecret });
    expect(connectionFor(APP_B)).toBeUndefined();
  });

  it('answers "invalid secret" when a stranger connect carries no secret', async () => {
    const { emit, sent, hasOutstandingSecret, consumeSecret } = makeEngine();
    hasOutstandingSecret.mockReturnValue(okAsync(true));

    const request = rpc('connect', [USER]);
    emit(makeEvent(request, { from: APP_B }));
    await flush();

    expect(consumeSecret).not.toHaveBeenCalled();
    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, error: NIP46_ERRORS.invalidSecret });
  });

  it('acks a duplicate connect from a known client without creating a record', async () => {
    pairApp(APP_B);
    const { emit, sent, consumeSecret } = makeEngine();

    const request = rpc('connect', [USER, 'whatever']);
    emit(makeEvent(request, { from: APP_B }));
    await flush();

    expect(parsedResponse(sent[0]!)).toEqual({ id: request.id, result: 'ack' });
    expect(consumeSecret).not.toHaveBeenCalled();
    expect(Object.keys(useNip46ConnectionsStore.getState().apps)).toEqual([APP_B]);
    expect(connectionFor(APP_B)?.requestCount).toBe(1);
  });
});

// ── nostrconnect pairing ────────────────────────────────────────

describe('nostrconnect pairing', () => {
  it('startNostrconnectPairing rebuilds the relay union with the client relays', () => {
    const { engine, transport } = makeEngine();

    expect(engine.startNostrconnectPairing(nostrconnectUri()).isOk()).toBe(true);

    const rebuildCalls = transport.rebuild.mock.calls as unknown as [string[]][];
    const lastRebuild = rebuildCalls.at(-1)?.[0];
    expect(lastRebuild).toEqual(expect.arrayContaining(['wss://client.relay.example']));
    expect(lastRebuild).toEqual(expect.arrayContaining(DEFAULT_RELAYS));
  });

  it('completeNostrconnectPairing upserts grants, echoes the secret, and logs', async () => {
    const { engine, sent } = makeEngine();
    const parsed = nostrconnectUri();
    engine.startNostrconnectPairing(parsed);

    const result = await engine.completeNostrconnectPairing({
      parsed,
      acceptedGrantKeys: ['sign_event:1', 'nip44_encrypt', 'nip44_decrypt'],
    });

    expect(result.isOk()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(parsedResponse(sent[0]!)).toEqual({ id: 'minted-id', result: parsed.secret });
    expect(sent[0]!.toPubkey).toBe(APP_B);

    const connection = connectionFor(APP_B);
    expect(connection).toMatchObject({ origin: 'nostrconnect', name: 'Primal' });
    expect(connection?.grants['sign_event:1']).toMatchObject({
      verdict: 'always',
      origin: 'pairing',
    });
    expect(connection?.grants['nip44_encrypt']).toMatchObject({ verdict: 'always' });
    // Critical ceiling: a decrypt always-grant is dropped by the store, never stored.
    expect(connection?.grants['nip44_decrypt']).toBeUndefined();
    expect(activityEntries()).toMatchObject([{ method: 'connect', verdict: 'approved_pairing' }]);
  });

  it('re-pair downgrades an unchecked presented grant from always back to ask', async () => {
    // App already paired with sign_event:1 'always' and an editor-set deny on
    // sign_event:6. The user re-pairs and UNCHECKS sign_event:1 (both keys are
    // presented). The always grant must be cleared; the deny must survive.
    pairApp(APP_B);
    expect(
      useNip46ConnectionsStore.getState().setGrant(APP_B, 'sign_event:1', 'always').isOk()
    ).toBe(true);
    expect(useNip46ConnectionsStore.getState().setGrant(APP_B, 'sign_event:6', 'deny').isOk()).toBe(
      true
    );
    const { engine } = makeEngine();
    const parsed = nostrconnectUri();
    engine.startNostrconnectPairing(parsed);

    const result = await engine.completeNostrconnectPairing({
      parsed,
      acceptedGrantKeys: [],
      presentedGrantKeys: ['sign_event:1', 'sign_event:6'],
    });

    expect(result.isOk()).toBe(true);
    expect(connectionFor(APP_B)?.grants['sign_event:1']).toBeUndefined(); // downgraded to ask
    expect(connectionFor(APP_B)?.grants['sign_event:6']).toMatchObject({ verdict: 'deny' }); // untouched
  });

  it('re-pair leaves grants intact when presentedGrantKeys is omitted', async () => {
    pairApp(APP_B);
    expect(
      useNip46ConnectionsStore.getState().setGrant(APP_B, 'sign_event:1', 'always').isOk()
    ).toBe(true);
    const { engine } = makeEngine();
    const parsed = nostrconnectUri();
    engine.startNostrconnectPairing(parsed);

    const result = await engine.completeNostrconnectPairing({ parsed, acceptedGrantKeys: [] });

    expect(result.isOk()).toBe(true);
    expect(connectionFor(APP_B)?.grants['sign_event:1']).toMatchObject({ verdict: 'always' });
  });

  describe('reconnect adoption (replacesClientPubkey)', () => {
    const OLD_CLIENT = '9'.repeat(64);

    /** Previous Primal pairing under an old ephemeral key, with saved config. */
    function seedPreviousPrimal(): void {
      const store = useNip46ConnectionsStore.getState();
      expect(
        store
          .upsertApp({
            clientPubkey: OLD_CLIENT,
            relays: ['wss://old.relay.example'],
            origin: 'nostrconnect',
            name: 'Primal',
            url: 'https://primal.net',
          })
          .isOk()
      ).toBe(true);
      expect(store.setGrant(OLD_CLIENT, 'sign_event:1', 'always').isOk()).toBe(true);
      expect(
        store.setPeerDecryptGrant(OLD_CLIENT, 'e'.repeat(64), 'nip44_decrypt', {
          peerIsSelf: false,
        }).isOk
      ).toBeDefined();
    }

    const reconnectUri = () => nostrconnectUri({ name: 'Primal', url: 'https://primal.net' });

    it('active match: adopts config, deletes the old record, revokes its session grants', async () => {
      seedPreviousPrimal();
      useNip46RequestsStore
        .getState()
        .grantSession(OLD_CLIENT, 'nip44_decrypt', 'e'.repeat(64), { peerIsSelf: false });
      const { engine, sent } = makeEngine();
      const parsed = reconnectUri();
      engine.startNostrconnectPairing(parsed);

      const result = await engine.completeNostrconnectPairing({
        parsed,
        acceptedGrantKeys: [],
        presentedGrantKeys: [],
        replacesClientPubkey: OLD_CLIENT,
      });

      expect(result.isOk()).toBe(true);
      expect(connectionFor(OLD_CLIENT)).toBeUndefined();
      const adopted = connectionFor(APP_B);
      expect(adopted?.grants['sign_event:1']).toMatchObject({ verdict: 'always' });
      expect(adopted?.peerDecryptGrants['e'.repeat(64)]?.methods).toEqual(['nip44_decrypt']);
      expect(adopted?.previousClientPubkeys).toEqual([OLD_CLIENT]);
      expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
      // Secret still echoed; activity logged under the NEW key.
      expect(parsedResponse(sent[0]!)).toEqual({ id: 'minted-id', result: parsed.secret });
      expect(activityEntries()[0]).toMatchObject({ clientPubkey: APP_B, method: 'connect' });
    });

    it('forged replacesClientPubkey (matcher disagrees) fails the pairing, nothing written', async () => {
      // The previous record claims a DIFFERENT hostname — the matcher would
      // never pick it, so inheritance must be refused outright.
      const store = useNip46ConnectionsStore.getState();
      expect(
        store
          .upsertApp({
            clientPubkey: OLD_CLIENT,
            relays: ['wss://old.relay.example'],
            origin: 'nostrconnect',
            name: 'Primal',
            url: 'https://evil.example',
          })
          .isOk()
      ).toBe(true);
      store.setGrant(OLD_CLIENT, 'sign_event:1', 'always');
      const { engine, sent } = makeEngine();
      const parsed = reconnectUri();
      engine.startNostrconnectPairing(parsed);

      const result = await engine.completeNostrconnectPairing({
        parsed,
        acceptedGrantKeys: [],
        replacesClientPubkey: OLD_CLIENT,
      });

      expect(result._unsafeUnwrapErr()).toEqual({
        type: 'adopt-failed',
        cause: 'inherit_mismatch',
      });
      expect(connectionFor(OLD_CLIENT)?.grants['sign_event:1']).toMatchObject({
        verdict: 'always',
      });
      expect(connectionFor(APP_B)).toBeUndefined();
      expect(sent).toHaveLength(0);
    });

    it('vanished previous record fails the pairing (no silent fresh fallback)', async () => {
      const { engine } = makeEngine();
      const parsed = reconnectUri();
      engine.startNostrconnectPairing(parsed);

      const result = await engine.completeNostrconnectPairing({
        parsed,
        acceptedGrantKeys: [],
        replacesClientPubkey: OLD_CLIENT,
      });

      expect(result._unsafeUnwrapErr()).toEqual({
        type: 'adopt-failed',
        cause: 'inherit_mismatch',
      });
      expect(connectionFor(APP_B)).toBeUndefined();
    });

    it('blocked match: fresh grants only, chain carried, block deliberately forgotten', async () => {
      seedPreviousPrimal();
      useNip46ConnectionsStore.getState().blockApp(OLD_CLIENT);
      const { engine } = makeEngine();
      const parsed = reconnectUri();
      engine.startNostrconnectPairing(parsed);

      const result = await engine.completeNostrconnectPairing({
        parsed,
        acceptedGrantKeys: ['sign_event:7'],
        replacesClientPubkey: OLD_CLIENT,
      });

      expect(result.isOk()).toBe(true);
      expect(connectionFor(OLD_CLIENT)).toBeUndefined();
      const adopted = connectionFor(APP_B);
      expect(adopted?.status).toBe('active');
      expect(adopted?.grants['sign_event:1']).toBeUndefined(); // nothing inherited
      expect(adopted?.grants['sign_event:7']).toMatchObject({ verdict: 'always' }); // fresh accept
      expect(adopted?.peerDecryptGrants).toEqual({});
      expect(adopted?.previousClientPubkeys).toEqual([OLD_CLIENT]);
    });

    it('expanded reconcile downgrades an inherited always-grant on the new record', async () => {
      seedPreviousPrimal();
      const { engine } = makeEngine();
      const parsed = reconnectUri();
      engine.startNostrconnectPairing(parsed);

      const result = await engine.completeNostrconnectPairing({
        parsed,
        acceptedGrantKeys: [],
        presentedGrantKeys: ['sign_event:1'],
        replacesClientPubkey: OLD_CLIENT,
      });

      expect(result.isOk()).toBe(true);
      expect(connectionFor(APP_B)?.grants['sign_event:1']).toBeUndefined();
    });
  });

  it('cancelNostrconnectPairing closes the stranger window again', async () => {
    const { engine, emit, transport } = makeEngine();
    engine.startNostrconnectPairing(nostrconnectUri());
    expect(engine.cancelNostrconnectPairing(APP_B).isOk()).toBe(true);

    emit(makeEvent(rpc('get_public_key'), { from: APP_B }));
    await flush();

    expect(transport.decryptEnvelope).not.toHaveBeenCalled();
  });
});

// ── Ask path + resolveRequest ───────────────────────────────────

interface AskHarness extends EngineHarness {
  requestId: string;
}

async function makeAsk(
  method = 'sign_event',
  params: string[] = signEventParams(),
  harness?: EngineHarness
): Promise<AskHarness> {
  const h = harness ?? makeEngine();
  if (!connectionFor(APP)) pairApp();
  const request = rpc(method, params);
  h.emit(makeEvent(request));
  await flush();
  expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toContain(request.id);
  return { ...h, requestId: request.id };
}

describe('ask path', () => {
  it('enqueues an ungrated request with a safe preview and notifies the UI callback', async () => {
    pairApp();
    const harness = makeEngine();
    const seen: string[] = [];
    const unsubscribe = harness.engine.onUserVerdictNeeded((request) => {
      seen.push(request.id);
    });

    const { requestId, sent } = await makeAsk('sign_event', signEventParams(), harness);

    expect(sent).toHaveLength(0); // deferred — no response until a verdict
    expect(seen).toEqual([requestId]);
    const pending = useNip46RequestsStore.getState().pending[0]!;
    expect(pending).toMatchObject({
      clientPubkey: APP,
      method: 'sign_event',
      kind: 1,
      expiresAt: now + REQUEST_TTL_MS,
    });
    expect(pending.paramsPreview).toMatchObject({ type: 'sign_event' });
    unsubscribe();
  });

  it('keeps ciphertext out of decrypt previews', async () => {
    await makeAsk('nip44_decrypt', [PEER, 'ciphertext-blob']);
    expect(useNip46RequestsStore.getState().pending[0]!.paramsPreview).toEqual({
      type: 'decrypt',
      peerPubkey: PEER,
      ciphertextLength: 'ciphertext-blob'.length,
    });
  });

  it('answers "rate limited" when the queue caps reject the newest request', async () => {
    pairApp();
    const harness = makeEngine();
    for (let i = 0; i < MAX_PENDING_PER_APP; i++) {
      harness.emit(makeEvent(rpc('sign_event', signEventParams())));
    }
    await flush(40);
    expect(useNip46RequestsStore.getState().pending).toHaveLength(MAX_PENDING_PER_APP);

    const overflow = rpc('sign_event', signEventParams());
    harness.emit(makeEvent(overflow));
    await flush();

    expect(useNip46RequestsStore.getState().pending).toHaveLength(MAX_PENDING_PER_APP);
    expect(harness.sent).toHaveLength(1);
    expect(parsedResponse(harness.sent[0]!)).toEqual({
      id: overflow.id,
      error: NIP46_ERRORS.rateLimited,
    });
    expect(activityEntries()).toMatchObject([{ verdict: 'auto_denied_rate_limited' }]);
  });
});

describe('resolveRequest', () => {
  it('approve_once executes, responds, logs approved_once with summary, and dequeues', async () => {
    const { engine, sent, requestId } = await makeAsk();

    const result = await engine.resolveRequest(requestId, { action: 'approve_once' });

    expect(result.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    const response = parsedResponse(sent[0]!);
    expect(response.id).toBe(requestId);
    expect(response.result).toBeDefined();
    expect(activityEntries()).toMatchObject([
      {
        verdict: 'approved_once',
        method: 'sign_event',
        kind: 1,
        contentPreview: 'hello from a client app',
      },
    ]);
    expect(connectionFor(APP)?.grants['sign_event:1']).toBeUndefined(); // once ≠ always

    const again = await engine.resolveRequest(requestId, { action: 'approve_once' });
    expect(again._unsafeUnwrapErr()).toEqual({ type: 'unknown-request' });
  });

  it('CONCURRENT verdicts on one request: first wins, second gets unknown-request', async () => {
    const { engine, sent, requestId } = await makeAsk();

    // The context handover is synchronous read-check-delete, so even two
    // verdicts racing through Promise.all must produce exactly one execution
    // (one wire response, one activity row) — this pins that invariant.
    const [first, second] = await Promise.all([
      engine.resolveRequest(requestId, { action: 'approve_once' }),
      engine.resolveRequest(requestId, { action: 'approve_once' }),
    ]);

    const outcomes = [first.isOk(), second.isOk()].sort();
    expect(outcomes).toEqual([false, true]);
    expect([first, second].find((r) => r.isErr())!._unsafeUnwrapErr()).toEqual({
      type: 'unknown-request',
    });
    expect(sent).toHaveLength(1);
    expect(activityEntries()).toHaveLength(1);
  });

  it('truncates the ask→approve content preview to SUMMARY_MAX_LENGTH (80)', async () => {
    const { engine, requestId } = await makeAsk(
      'sign_event',
      signEventParams({ content: 'x'.repeat(200) })
    );

    expect((await engine.resolveRequest(requestId, { action: 'approve_once' })).isOk()).toBe(true);

    expect(activityEntries()[0]!.contentPreview).toHaveLength(80);
  });

  it('always persists an always grant and future requests auto-approve', async () => {
    const { engine, emit, sent, requestId } = await makeAsk();

    expect((await engine.resolveRequest(requestId, { action: 'always' })).isOk()).toBe(true);
    expect(connectionFor(APP)?.grants['sign_event:1']).toMatchObject({
      verdict: 'always',
      origin: 'prompt',
    });

    emit(makeEvent(rpc('sign_event', signEventParams())));
    await flush();

    expect(sent).toHaveLength(2);
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_approved_grant' });
  });

  it('always grants the WHOLE bundle of the request key (one human concept)', async () => {
    const { engine, requestId } = await makeAsk('nip44_encrypt', [PEER, 'hello']);

    expect((await engine.resolveRequest(requestId, { action: 'always' })).isOk()).toBe(true);

    const grants = connectionFor(APP)?.grants ?? {};
    for (const key of [
      'sign_event:4',
      'sign_event:13',
      'nip04_encrypt',
      'nip44_encrypt',
    ] as const) {
      expect(grants[key]).toMatchObject({ verdict: 'always' });
    }
    // Never-sign kinds stay outside the bundle.
    expect(grants['sign_event:14']).toBeUndefined();
  });

  it('always on an unbundled key grants only that key', async () => {
    const { engine, requestId } = await makeAsk('sign_event', signEventParams({ kind: 31337 }));

    expect((await engine.resolveRequest(requestId, { action: 'always' })).isOk()).toBe(true);

    const grants = connectionFor(APP)?.grants ?? {};
    expect(grants['sign_event:31337']).toMatchObject({ verdict: 'always' });
    expect(Object.keys(grants)).toEqual(['sign_event:31337']);
  });

  it('per-key reconcile downgrades one bundle member, siblings survive', async () => {
    const { engine, requestId } = await makeAsk('nip44_encrypt', [PEER, 'hello']);
    await engine.resolveRequest(requestId, { action: 'always' });

    // Re-pair presents nip44_encrypt unchecked → only that member downgrades.
    const parsed = nostrconnectUri({ clientPubkey: APP });
    engine.startNostrconnectPairing(parsed);
    const result = await engine.completeNostrconnectPairing({
      parsed,
      acceptedGrantKeys: [],
      presentedGrantKeys: ['nip44_encrypt'],
    });

    expect(result.isOk()).toBe(true);
    const grants = connectionFor(APP)?.grants ?? {};
    expect(grants['nip44_encrypt']).toBeUndefined();
    expect(grants['sign_event:4']).toMatchObject({ verdict: 'always' });
    expect(grants['sign_event:13']).toMatchObject({ verdict: 'always' });
  });

  it('always on a SELF-decrypt executes once but the ceiling blocks any grant', async () => {
    pairApp();
    const harness = makeEngine();
    const { requestId } = await makeAsk('nip44_decrypt', [USER, 'ciphertext'], harness);

    const result = await harness.engine.resolveRequest(requestId, { action: 'always' });

    expect(result.isOk()).toBe(true);
    expect(connectionFor(APP)?.grants['nip44_decrypt']).toBeUndefined();
    expect(connectionFor(APP)?.peerDecryptGrants).toEqual({});
    expect(parsedResponse(harness.sent[0]!)).toEqual({ id: requestId, result: 'pt44' });

    // Next identical request still asks — nothing was persisted.
    const second = rpc('nip44_decrypt', [USER, 'ciphertext-2']);
    harness.emit(makeEvent(second));
    await flush();
    expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toEqual([second.id]);
  });

  it('deny_once responds "Not authorized" and logs denied_once', async () => {
    const { engine, sent, requestId } = await makeAsk();

    expect((await engine.resolveRequest(requestId, { action: 'deny_once' })).isOk()).toBe(true);

    expect(parsedResponse(sent[0]!)).toEqual({ id: requestId, error: NIP46_ERRORS.notAuthorized });
    expect(activityEntries()).toMatchObject([{ verdict: 'denied_once' }]);
    expect(connectionFor(APP)?.deniedCount).toBe(1);
    expect(connectionFor(APP)?.grants['sign_event:1']).toBeUndefined();
  });

  it('always_deny persists a deny grant and future requests auto-deny', async () => {
    const { engine, emit, sent, requestId } = await makeAsk();

    expect((await engine.resolveRequest(requestId, { action: 'always_deny' })).isOk()).toBe(true);
    expect(connectionFor(APP)?.grants['sign_event:1']).toMatchObject({ verdict: 'deny' });

    emit(makeEvent(rpc('sign_event', signEventParams())));
    await flush();

    expect(sent).toHaveLength(2);
    expect(parsedResponse(sent[1]!).error).toBe(NIP46_ERRORS.notAuthorized);
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_denied_grant' });
  });

  it('block denies the prompted request, blocks the app, and silently flushes its queue', async () => {
    pairApp();
    const harness = makeEngine();
    const first = await makeAsk('sign_event', signEventParams(), harness);
    const second = rpc('sign_event', signEventParams());
    harness.emit(makeEvent(second));
    await flush();
    expect(useNip46RequestsStore.getState().pending).toHaveLength(2);

    const result = await harness.engine.resolveRequest(first.requestId, { action: 'block' });

    expect(result.isOk()).toBe(true);
    expect(connectionFor(APP)?.status).toBe('blocked');
    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    // Exactly one response: the prompted request. The flushed one is silent.
    expect(harness.sent).toHaveLength(1);
    expect(parsedResponse(harness.sent[0]!)).toEqual({
      id: first.requestId,
      error: NIP46_ERRORS.notAuthorized,
    });
    expect(activityEntries()).toMatchObject([
      { verdict: 'denied_once' },
      { verdict: 'auto_denied_blocked' },
    ]);

    const flushed = await harness.engine.resolveRequest(second.id, { action: 'approve_once' });
    expect(flushed._unsafeUnwrapErr()).toEqual({ type: 'unknown-request' });
  });

  it('unknown request ids err', async () => {
    const { engine } = makeEngine();
    const result = await engine.resolveRequest('nope', { action: 'approve_once' });
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'unknown-request' });
  });

  it('never responds when the app was disconnected mid-prompt (deny and approve)', async () => {
    const first = await makeAsk();
    const second = rpc('sign_event', signEventParams());
    first.emit(makeEvent(second));
    await flush();
    useNip46ConnectionsStore.getState().disconnectApp(APP);

    expect(
      (await first.engine.resolveRequest(first.requestId, { action: 'deny_once' })).isOk()
    ).toBe(true);
    expect((await first.engine.resolveRequest(second.id, { action: 'approve_once' })).isOk()).toBe(
      true
    );

    // Unpaired pubkey: zero wire responses on either verdict.
    expect(first.sent).toHaveLength(0);
  });

  it('stays silent on approve/deny when the app was blocked mid-prompt outside the sheet', async () => {
    const first = await makeAsk();
    const second = rpc('sign_event', signEventParams());
    first.emit(makeEvent(second));
    await flush();
    useNip46ConnectionsStore.getState().blockApp(APP); // app-detail screen, not the prompt

    expect(
      (await first.engine.resolveRequest(first.requestId, { action: 'approve_once' })).isOk()
    ).toBe(true);
    expect((await first.engine.resolveRequest(second.id, { action: 'deny_once' })).isOk()).toBe(
      true
    );

    expect(first.sent).toHaveLength(0); // blocked tier: activity rows only
    expect(activityEntries()).toMatchObject([
      { verdict: 'denied_once' },
      { verdict: 'auto_denied_blocked' },
    ]);
  });
});

describe('structured activity summaries', () => {
  it('approve path logs a human-readable headline/line for a kind-7 like', async () => {
    const target = '2'.repeat(64);
    const { engine, requestId } = await makeAsk(
      'sign_event',
      signEventParams({ kind: 7, content: '+', tags: [['e', target]] })
    );

    expect((await engine.resolveRequest(requestId, { action: 'approve_once' })).isOk()).toBe(true);

    expect(activityEntries()[0]).toMatchObject({
      verdict: 'approved_once',
      summary: { headline: 'Like a Post', line: 'Liked a post', refEventId: target },
    });
  });

  it('denied requests keep the structured summary', async () => {
    const { engine, requestId } = await makeAsk(
      'sign_event',
      signEventParams({ kind: 30078, tags: [['d', 'Primal-Web App', 'get_app_settings']] })
    );

    await engine.resolveRequest(requestId, { action: 'deny_once' });

    expect(activityEntries()[0]).toMatchObject({
      verdict: 'denied_once',
      summary: { headline: 'Load App Settings' },
    });
  });

  it('decrypt entries carry the peer pubkey and never ciphertext', async () => {
    const { engine, requestId } = await makeAsk('nip44_decrypt', [PEER, 'ct-secret-material']);

    await engine.resolveRequest(requestId, { action: 'approve_once' });

    const entry = activityEntries()[0] as unknown as Record<string, unknown>;
    expect(entry).toMatchObject({ summary: { refPubkey: PEER } });
    expect(JSON.stringify(entry)).not.toContain('ct-secret-material');
  });
});

describe('session approvals', () => {
  it('approve_session on a peer decrypt mints a session grant; next same-peer auto-approves even much later', async () => {
    const { engine, emit, sent, requestId } = await makeAsk('nip44_decrypt', [PEER, 'ct-1']);

    const result = await engine.resolveRequest(requestId, { action: 'approve_session' });
    expect(result.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().sessionGrants).toMatchObject([
      { clientPubkey: APP, grantKey: 'nip44_decrypt', peerPubkey: PEER },
    ]);

    // Sessions have no TTL — a day later still auto-approves.
    now += 24 * 3_600_000;
    emit(makeEvent(rpc('nip44_decrypt', [PEER, 'ct-2'])));
    await flush();

    expect(sent).toHaveLength(2);
    expect(parsedResponse(sent[1]!).result).toBe('pt44');
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_approved_session' });
  });

  it('a session grant for one peer does NOT cover a different peer — prompts again', async () => {
    const otherPeer = 'd'.repeat(64);
    const { engine, emit, requestId } = await makeAsk('nip44_decrypt', [PEER, 'ct-1']);
    await engine.resolveRequest(requestId, { action: 'approve_session' });

    emit(makeEvent(rpc('nip44_decrypt', [otherPeer, 'ct-2'])));
    await flush();

    expect(useNip46RequestsStore.getState().pending).toHaveLength(1);
  });

  it('always on a peer decrypt persists a peerDecryptGrants entry; next same-peer auto-approves', async () => {
    const { engine, emit, sent, requestId } = await makeAsk('nip44_decrypt', [PEER, 'ct-1']);

    const result = await engine.resolveRequest(requestId, { action: 'always' });
    expect(result.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
    const app = useNip46ConnectionsStore.getState().apps[APP]!;
    expect(app.peerDecryptGrants[PEER]).toMatchObject({ methods: ['nip44_decrypt'] });
    // The blanket grants map stays untouched — the critical ceiling holds.
    expect(app.grants.nip44_decrypt).toBeUndefined();

    emit(makeEvent(rpc('nip44_decrypt', [PEER, 'ct-2'])));
    await flush();

    expect(sent).toHaveLength(2);
    expect(parsedResponse(sent[1]!).result).toBe('pt44');
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_approved_peer_grant' });
  });

  it('approve_session on decrypt-to-self falls back to once — keeps prompting', async () => {
    const { engine, emit, requestId } = await makeAsk('nip44_decrypt', [USER, 'wallet-ct']);

    const result = await engine.resolveRequest(requestId, { action: 'approve_session' });

    expect(result.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
    expect(useNip46RequestsStore.getState().sessionAllows).toEqual([]);

    emit(makeEvent(rpc('nip44_decrypt', [USER, 'wallet-ct-2'])));
    await flush();
    expect(useNip46RequestsStore.getState().pending).toHaveLength(1);
  });

  it('approve_session on a bundled sign kind covers the whole bundle for the session', async () => {
    const { engine, emit, sent, requestId } = await makeAsk();

    const result = await engine.resolveRequest(requestId, { action: 'approve_session' });
    expect(result.isOk()).toBe(true);
    // Kind 1 belongs to postPublicly — siblings ride along, runtime-only.
    const allowKeys = useNip46RequestsStore.getState().sessionAllows.map((a) => a.grantKey);
    expect(allowKeys).toEqual(
      expect.arrayContaining(['sign_event:1', 'sign_event:1111', 'sign_event:30023'])
    );
    // Nothing persisted.
    expect(useNip46ConnectionsStore.getState().apps[APP]!.grants).toEqual({});

    emit(makeEvent(rpc('sign_event', signEventParams({ kind: 30023 }))));
    await flush();

    expect(sent).toHaveLength(2);
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_approved_session' });
  });

  it('approve_session on a WALLET sign kind auto-approves for the session (runtime-only)', async () => {
    const { engine, emit, sent, requestId } = await makeAsk(
      'sign_event',
      signEventParams({ kind: 17375 })
    );

    const result = await engine.resolveRequest(requestId, { action: 'approve_session' });
    expect(result.isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().sessionAllows).toMatchObject([
      { clientPubkey: APP, grantKey: 'sign_event:17375' },
    ]);
    // The persisted critical ceiling is untouched.
    expect(useNip46ConnectionsStore.getState().apps[APP]!.grants).toEqual({});

    emit(makeEvent(rpc('sign_event', signEventParams({ kind: 17375 }))));
    await flush();

    expect(sent).toHaveLength(2);
    expect(activityEntries()[0]).toMatchObject({ verdict: 'auto_approved_session' });
  });

  it('stop() ends the session — all session state cleared', async () => {
    const { engine, requestId } = await makeAsk('nip44_decrypt', [PEER, 'ct-1']);
    await engine.resolveRequest(requestId, { action: 'approve_session' });
    const harness2 = await makeAsk();
    await harness2.engine.resolveRequest(harness2.requestId, { action: 'approve_session' });

    engine.stop();
    harness2.engine.stop();

    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
    expect(useNip46RequestsStore.getState().sessionAllows).toEqual([]);
  });

  it('block clears the app session state', async () => {
    const { engine, requestId } = await makeAsk();
    await engine.resolveRequest(requestId, { action: 'approve_session' });
    expect(useNip46RequestsStore.getState().sessionAllows.length).toBeGreaterThan(0);

    const harness = await makeAsk('sign_event', signEventParams({ kind: 5 }), undefined);
    await harness.engine.resolveRequest(harness.requestId, { action: 'block' });

    expect(useNip46RequestsStore.getState().sessionAllows).toEqual([]);
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
  });
});

// ── Expiry sweep ────────────────────────────────────────────────

describe('expiry sweep', () => {
  it('responds "request expired", logs expired, and drops the resolver', async () => {
    jest.useFakeTimers();
    const { engine, sent, requestId } = await makeAsk();

    now += REQUEST_TTL_MS + 1;
    await jest.advanceTimersByTimeAsync(EXPIRY_SWEEP_INTERVAL_MS);

    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(parsedResponse(sent[0]!)).toEqual({
      id: requestId,
      error: NIP46_ERRORS.requestExpired,
    });
    expect(activityEntries()).toMatchObject([{ verdict: 'expired', method: 'sign_event' }]);

    const resolved = await engine.resolveRequest(requestId, { action: 'approve_once' });
    expect(resolved._unsafeUnwrapErr()).toEqual({ type: 'unknown-request' });

    // Queue is empty → the sweep interval has been cleared.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves unexpired requests queued', async () => {
    jest.useFakeTimers();
    await makeAsk();

    now += REQUEST_TTL_MS - 1_000;
    await jest.advanceTimersByTimeAsync(EXPIRY_SWEEP_INTERVAL_MS);

    expect(useNip46RequestsStore.getState().pending).toHaveLength(1);
  });

  it('never responds to an app blocked or disconnected after enqueue — expired rows only', async () => {
    jest.useFakeTimers();
    const harness = await makeAsk();
    const fromB = rpc('sign_event', signEventParams());
    pairApp(APP_B);
    harness.emit(makeEvent(fromB, { from: APP_B }));
    await flush();
    expect(useNip46RequestsStore.getState().pending).toHaveLength(2);
    useNip46ConnectionsStore.getState().blockApp(APP);
    useNip46ConnectionsStore.getState().disconnectApp(APP_B);

    now += REQUEST_TTL_MS + 1;
    await jest.advanceTimersByTimeAsync(EXPIRY_SWEEP_INTERVAL_MS);

    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    expect(harness.sent).toHaveLength(0);
    expect(activityEntries()).toMatchObject([{ verdict: 'expired' }, { verdict: 'expired' }]);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────

describe('lifecycle', () => {
  it('start is idempotent and wires the relay union (defaults ∪ connection relays)', () => {
    pairApp(APP, ['wss://relay.damus.io', 'wss://app.specific.relay']);
    const { engine, transport } = makeEngine();

    expect(transport.start).toHaveBeenCalledTimes(1);
    const params = transport.start.mock.calls[0]![0] as unknown as {
      relayUrls: string[];
      sinceEpochSec: number;
    };
    expect(params.relayUrls).toEqual(
      expect.arrayContaining(['wss://relay.damus.io', 'wss://app.specific.relay'])
    );
    expect(params.sinceEpochSec).toBe(nowSec() - 300);

    expect(engine.start({ signer: fakeSigner, userPubkey: USER }).isOk()).toBe(true);
    expect(transport.start).toHaveBeenCalledTimes(1);
  });

  it('stop clears the queue and resolver contexts and stops the transport', async () => {
    const { engine, transport, requestId } = await makeAsk();

    expect(engine.stop().isOk()).toBe(true);

    expect(transport.stop).toHaveBeenCalledTimes(1);
    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    expect(engine.isStarted).toBe(false);
    const resolved = await engine.resolveRequest(requestId, { action: 'approve_once' });
    expect(resolved._unsafeUnwrapErr()).toEqual({ type: 'not-started' });
  });

  it('stop during an in-flight decrypt never enqueues, responds, or signs', async () => {
    pairApp();
    const harness = makeEngine();
    let resolveDecrypt: ((value: { plaintext: string; used: Nip46Encryption }) => void) | undefined;
    const deferredDecrypt = ResultAsync.fromPromise(
      new Promise<{ plaintext: string; used: Nip46Encryption }>((resolve) => {
        resolveDecrypt = resolve;
      }),
      () => ({ type: 'decrypt-failed' as const, cause: { name: 'E', message: 'x' } })
    );
    harness.transport.decryptEnvelope.mockImplementationOnce((() => deferredDecrypt) as never);

    const request = rpc('sign_event', signEventParams());
    harness.emit(makeEvent(request));
    await flush();
    expect(useNip46RequestsStore.getState().pending).toHaveLength(0); // decrypt still in flight

    expect(harness.engine.stop().isOk()).toBe(true);
    resolveDecrypt!({ plaintext: JSON.stringify(request), used: 'nip44' });
    await flush();

    // The continuation re-checks the engine epoch after the await and bails.
    expect(useNip46RequestsStore.getState().pending).toHaveLength(0);
    expect(harness.sent).toHaveLength(0);
    expect(harness.rateLimiter.take).not.toHaveBeenCalled();
  });

  it('reconnect delegates to the transport (which owns the overlap-safe since)', () => {
    const { engine, transport } = makeEngine();

    expect(engine.reconnect().isOk()).toBe(true);

    expect(transport.reconnect).toHaveBeenCalledTimes(1);
    expect(transport.reconnect).toHaveBeenCalledWith();
  });
});
