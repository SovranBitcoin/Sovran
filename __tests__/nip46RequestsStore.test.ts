/**
 * Pins the runtime-only NIP-46 requests store: FIFO queue caps (10/app,
 * 25 global — the incoming request is rejected, queued prompts are never
 * evicted), TTL expiry sweep, session-grant TTL + the peer≠self/decrypt-only
 * guards, and the throttle flags.
 */

/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

import {
  useNip46RequestsStore,
  type Nip46PendingRequest,
  type SessionGrantKey,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  MAX_PENDING_GLOBAL,
  MAX_PENDING_PER_APP,
  SESSION_GRANT_TTL_MS,
} from '@/features/nostrSigner/lib/nip46Types';

const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);
const APP_C = 'c'.repeat(64);

let seq = 0;

function makeRequest(overrides: Partial<Nip46PendingRequest> = {}): Nip46PendingRequest {
  seq += 1;
  return {
    id: `rpc-${seq}`,
    eventId: `${seq}`.padStart(64, '0'),
    clientPubkey: APP_A,
    connectionKnown: true,
    method: 'sign_event',
    kind: 1,
    paramsPreview: { type: 'none' },
    receivedAt: 1_000,
    expiresAt: 121_000,
    ...overrides,
  };
}

beforeEach(() => {
  useNip46RequestsStore.setState({ pending: [], sessionGrants: [], throttledApps: {} });
});

describe('pending queue', () => {
  it('appends FIFO and removes by id', () => {
    const store = useNip46RequestsStore.getState();
    const first = makeRequest();
    const second = makeRequest();
    expect(store.enqueue(first).isOk()).toBe(true);
    expect(store.enqueue(second).isOk()).toBe(true);

    expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toEqual([
      first.id,
      second.id,
    ]);

    store.remove(first.id);
    expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toEqual([second.id]);
  });

  it('rejects duplicates by event id and rpc id', () => {
    const store = useNip46RequestsStore.getState();
    const request = makeRequest();
    expect(store.enqueue(request).isOk()).toBe(true);
    expect(store.enqueue({ ...makeRequest(), eventId: request.eventId })._unsafeUnwrapErr()).toBe(
      'duplicate'
    );
    expect(store.enqueue({ ...makeRequest(), id: request.id })._unsafeUnwrapErr()).toBe(
      'duplicate'
    );
    expect(useNip46RequestsStore.getState().pending).toHaveLength(1);
  });

  it('rejects the newest request past the per-app cap of 10', () => {
    const store = useNip46RequestsStore.getState();
    for (let i = 0; i < MAX_PENDING_PER_APP; i++) {
      expect(store.enqueue(makeRequest()).isOk()).toBe(true);
    }
    expect(store.enqueue(makeRequest())._unsafeUnwrapErr()).toBe('per_app_cap');
    // Another app is unaffected by A's cap.
    expect(store.enqueue(makeRequest({ clientPubkey: APP_B })).isOk()).toBe(true);
    expect(useNip46RequestsStore.getState().pending).toHaveLength(MAX_PENDING_PER_APP + 1);
  });

  it('rejects the newest request past the global cap of 25', () => {
    const store = useNip46RequestsStore.getState();
    for (const app of [APP_A, APP_B]) {
      for (let i = 0; i < MAX_PENDING_PER_APP; i++) {
        expect(store.enqueue(makeRequest({ clientPubkey: app })).isOk()).toBe(true);
      }
    }
    for (let i = 0; i < MAX_PENDING_GLOBAL - 2 * MAX_PENDING_PER_APP; i++) {
      expect(store.enqueue(makeRequest({ clientPubkey: APP_C })).isOk()).toBe(true);
    }
    expect(useNip46RequestsStore.getState().pending).toHaveLength(MAX_PENDING_GLOBAL);

    const overflow = store.enqueue(makeRequest({ clientPubkey: 'd'.repeat(64) }));
    expect(overflow._unsafeUnwrapErr()).toBe('global_cap');
    expect(useNip46RequestsStore.getState().pending).toHaveLength(MAX_PENDING_GLOBAL);
  });

  it('expireDue removes and returns only requests past their TTL', () => {
    const store = useNip46RequestsStore.getState();
    const expired = makeRequest({ expiresAt: 5_000 });
    const alive = makeRequest({ expiresAt: 10_000 });
    store.enqueue(expired);
    store.enqueue(alive);

    const swept = store.expireDue(5_000);
    expect(swept.map((p) => p.id)).toEqual([expired.id]);
    expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toEqual([alive.id]);

    expect(store.expireDue(5_000)).toEqual([]);
  });

  it('clear empties the queue', () => {
    const store = useNip46RequestsStore.getState();
    store.enqueue(makeRequest());
    store.clear();
    expect(useNip46RequestsStore.getState().pending).toEqual([]);
  });

  it('promote moves a request to the head and preserves the rest of the order', () => {
    const store = useNip46RequestsStore.getState();
    const first = makeRequest();
    const second = makeRequest({ clientPubkey: APP_B });
    const third = makeRequest({ clientPubkey: APP_C });
    store.enqueue(first);
    store.enqueue(second);
    store.enqueue(third);

    store.promote(third.id);
    expect(useNip46RequestsStore.getState().pending.map((p) => p.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);

    // Promoting the head and promoting an unknown id are both no-ops.
    const stable = useNip46RequestsStore.getState().pending;
    store.promote(third.id);
    expect(useNip46RequestsStore.getState().pending).toBe(stable);
    store.promote('missing');
    expect(useNip46RequestsStore.getState().pending).toBe(stable);
  });
});

describe('session grants', () => {
  const NOW = 1_000_000;

  it('grants for 1 hour and expires at the TTL boundary', () => {
    const store = useNip46RequestsStore.getState();
    expect(store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW).isOk()).toBe(
      true
    );

    expect(store.hasSessionGrant(APP_A, 'nip44_decrypt', NOW)).toBe(true);
    expect(store.hasSessionGrant(APP_A, 'nip44_decrypt', NOW + SESSION_GRANT_TTL_MS - 1)).toBe(
      true
    );
    expect(store.hasSessionGrant(APP_A, 'nip44_decrypt', NOW + SESSION_GRANT_TTL_MS)).toBe(false);
  });

  it('scopes grants to app and key', () => {
    const store = useNip46RequestsStore.getState();
    store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW);
    expect(store.hasSessionGrant(APP_B, 'nip44_decrypt', NOW)).toBe(false);
    expect(store.hasSessionGrant(APP_A, 'nip04_decrypt', NOW)).toBe(false);
    expect(store.hasSessionGrant(APP_A, 'sign_event:17375', NOW)).toBe(false);
  });

  it('refuses a grant asserting peerIsSelf — wallet payload decrypts always prompt', () => {
    const selfGuard = { peerIsSelf: true };
    const result = useNip46RequestsStore
      .getState()
      .grantSession(APP_A, 'nip44_decrypt', selfGuard as never, NOW);
    expect(result._unsafeUnwrapErr()).toBe('self_decrypt_forbidden');
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
  });

  it('refuses non-decrypt keys smuggled past the type system', () => {
    const result = useNip46RequestsStore
      .getState()
      .grantSession(APP_A, 'sign_event:17375' as SessionGrantKey, { peerIsSelf: false }, NOW);
    expect(result._unsafeUnwrapErr()).toBe('not_session_grantable');
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([]);
  });

  it('re-granting refreshes the expiry instead of duplicating', () => {
    const store = useNip46RequestsStore.getState();
    store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW);
    store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW + 1_000);

    const grants = useNip46RequestsStore.getState().sessionGrants;
    expect(grants).toHaveLength(1);
    expect(grants[0].expiresAt).toBe(NOW + 1_000 + SESSION_GRANT_TTL_MS);
  });

  it('revokes one key or all keys for an app', () => {
    const store = useNip46RequestsStore.getState();
    store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW);
    store.grantSession(APP_A, 'nip04_decrypt', { peerIsSelf: false }, NOW);
    store.grantSession(APP_B, 'nip44_decrypt', { peerIsSelf: false }, NOW);

    store.revokeSessionGrant(APP_A, 'nip44_decrypt');
    expect(store.hasSessionGrant(APP_A, 'nip44_decrypt', NOW)).toBe(false);
    expect(store.hasSessionGrant(APP_A, 'nip04_decrypt', NOW)).toBe(true);

    store.revokeSessionGrant(APP_A);
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([
      expect.objectContaining({ clientPubkey: APP_B }),
    ]);
  });

  it('prunes expired grants', () => {
    const store = useNip46RequestsStore.getState();
    store.grantSession(APP_A, 'nip44_decrypt', { peerIsSelf: false }, NOW);
    store.grantSession(APP_B, 'nip44_decrypt', { peerIsSelf: false }, NOW + SESSION_GRANT_TTL_MS);

    store.pruneSessionGrants(NOW + SESSION_GRANT_TTL_MS);
    expect(useNip46RequestsStore.getState().sessionGrants).toEqual([
      expect.objectContaining({ clientPubkey: APP_B }),
    ]);
  });
});

describe('throttled apps', () => {
  it('sets and clears UI flags', () => {
    const store = useNip46RequestsStore.getState();
    store.setAppThrottled(APP_A, true);
    expect(useNip46RequestsStore.getState().throttledApps).toEqual({ [APP_A]: true });

    store.setAppThrottled(APP_A, false);
    expect(useNip46RequestsStore.getState().throttledApps).toEqual({});

    // Clearing an absent flag is a no-op.
    store.setAppThrottled(APP_B, false);
    expect(useNip46RequestsStore.getState().throttledApps).toEqual({});
  });
});
