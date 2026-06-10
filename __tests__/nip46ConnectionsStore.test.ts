/**
 * Pins the NIP-46 connections store: persisted round-trip through the
 * schema-validated merge, the critical-grant ceiling at both enforcement
 * points (setGrant action + schema refine on a hand-crafted tampered blob),
 * the 64-app cap, and grant lifecycle (set / clear-to-ask / usage touch).
 */

/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
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
    __storageMap: map,
  };
});

import {
  isCriticalGrantKey,
  useNip46ConnectionsStore,
  type Nip46Connection,
  type UpsertAppInput,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';

const { __storageMap: storageMap } = jest.requireMock(
  '@/shared/lib/cashu/profileScopedStorage'
) as {
  __storageMap: Map<string, string>;
};

const STORAGE_KEY = 'nip46-connections-store';

const pk = (index: number) => index.toString(16).padStart(64, '0');

function baseInput(clientPubkey: string, overrides: Partial<UpsertAppInput> = {}): UpsertAppInput {
  return {
    clientPubkey,
    relays: ['wss://relay.damus.io'],
    origin: 'nostrconnect',
    ...overrides,
  };
}

function persistedConnection(clientPubkey: string): Nip46Connection {
  return {
    clientPubkey,
    relays: ['wss://relay.damus.io'],
    origin: 'nostrconnect',
    status: 'active',
    mode: 'standard',
    encryption: 'nip44',
    pairedAt: 1_700_000_000_000,
    requestCount: 0,
    deniedCount: 0,
    grants: {},
    peerDecryptGrants: {},
    previousClientPubkeys: [],
  };
}

function writeBlob(apps: Record<string, Nip46Connection>, version = 3): void {
  storageMap.set(STORAGE_KEY, JSON.stringify({ state: { apps }, version }));
}

async function flushPersistWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  storageMap.clear();
  useNip46ConnectionsStore.setState({ apps: {} });
});

describe('isCriticalGrantKey', () => {
  it.each(['nip04_decrypt', 'nip44_decrypt', 'sign_event:17375', 'sign_event:5'] as const)(
    'classifies %s as critical',
    (key) => {
      expect(isCriticalGrantKey(key)).toBe(true);
    }
  );

  it.each(['sign_event:1', 'sign_event:0', 'nip44_encrypt', 'nip04_encrypt'] as const)(
    'classifies %s as grantable',
    (key) => {
      expect(isCriticalGrantKey(key)).toBe(false);
    }
  );
});

describe('persisted round-trip', () => {
  it('survives partialize → storage → schema-validated merge', async () => {
    const client = pk(1);
    const store = useNip46ConnectionsStore.getState();
    expect(
      store.upsertApp(baseInput(client, { name: 'Primal', url: 'https://primal.net' })).isOk()
    ).toBe(true);
    expect(store.setGrant(client, 'sign_event:1', 'always').isOk()).toBe(true);
    expect(store.setGrant(client, 'nip44_decrypt', 'deny').isOk()).toBe(true);
    await flushPersistWrites();

    const blob = storageMap.get(STORAGE_KEY);
    expect(blob).toBeDefined();
    const before = useNip46ConnectionsStore.getState().apps[client];
    // Resetting state triggers a persist write of the empty state — flush it,
    // then restore the captured blob so rehydrate reads the real data.
    useNip46ConnectionsStore.setState({ apps: {} });
    await flushPersistWrites();
    storageMap.set(STORAGE_KEY, blob!);
    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps[client]).toEqual(before);
    expect(useNip46ConnectionsStore.getState().apps[client].grants['sign_event:1']?.verdict).toBe(
      'always'
    );
  });
});

describe('tampered blob rejection at merge', () => {
  it('rejects an always verdict on nip44_decrypt and keeps in-memory state', async () => {
    const client = pk(2);
    const tampered = persistedConnection(client);
    tampered.grants = {
      nip44_decrypt: { verdict: 'always', origin: 'prompt', createdAt: 1, useCount: 0 },
    };
    writeBlob({ [client]: tampered });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });

  it('rejects an always verdict on a critical sign kind', async () => {
    const client = pk(3);
    const tampered = persistedConnection(client);
    tampered.grants = {
      'sign_event:17375': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 0 },
    };
    writeBlob({ [client]: tampered });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });

  it('rejects a blob whose record key mismatches the clientPubkey field', async () => {
    writeBlob({ [pk(4)]: persistedConnection(pk(5)) });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });

  it('accepts the same blob shape once the verdict is deny', async () => {
    const client = pk(6);
    const valid = persistedConnection(client);
    valid.grants = {
      nip44_decrypt: { verdict: 'deny', origin: 'prompt', createdAt: 1, useCount: 0 },
    };
    writeBlob({ [client]: valid });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps[client]?.grants.nip44_decrypt?.verdict).toBe(
      'deny'
    );
  });

  // Corrupt persisted grants (bitrot, downgrade, hand-edit) must fail closed
  // at the schema gate — rejected wholesale, never a crash or a partial load.
  it.each([
    ['unknown verdict enum', { verdict: 'maybe', origin: 'prompt', createdAt: 1, useCount: 0 }],
    ['missing verdict field', { origin: 'prompt', createdAt: 1, useCount: 0 }],
    ['negative createdAt', { verdict: 'deny', origin: 'prompt', createdAt: -5, useCount: 0 }],
    ['unknown origin', { verdict: 'deny', origin: 'telepathy', createdAt: 1, useCount: 0 }],
  ])('rejects a grant with %s without crashing rehydrate', async (_label, corruptGrant) => {
    const client = pk(8);
    const tampered = persistedConnection(client);
    tampered.grants = { 'sign_event:1': corruptGrant as never };
    writeBlob({ [client]: tampered });

    await expect(useNip46ConnectionsStore.persist.rehydrate()).resolves.not.toThrow();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });
});

describe('setGrant critical ceiling', () => {
  const client = pk(7);

  beforeEach(() => {
    expect(useNip46ConnectionsStore.getState().upsertApp(baseInput(client)).isOk()).toBe(true);
  });

  it.each(['nip44_decrypt', 'nip04_decrypt', 'sign_event:17375', 'sign_event:7375'] as const)(
    'rejects always on critical key %s',
    (key) => {
      const result = useNip46ConnectionsStore.getState().setGrant(client, key, 'always');
      expect(result._unsafeUnwrapErr()).toBe('critical_always_forbidden');
      expect(useNip46ConnectionsStore.getState().apps[client].grants[key]).toBeUndefined();
    }
  );

  it('allows deny on critical keys and always on grantable keys', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(store.setGrant(client, 'nip44_decrypt', 'deny').isOk()).toBe(true);
    expect(store.setGrant(client, 'sign_event:1', 'always').isOk()).toBe(true);
    expect(store.setGrant(client, 'nip44_encrypt', 'always').isOk()).toBe(true);

    const grants = useNip46ConnectionsStore.getState().apps[client].grants;
    expect(grants.nip44_decrypt?.verdict).toBe('deny');
    expect(grants['sign_event:1']?.verdict).toBe('always');
    expect(grants.nip44_encrypt?.verdict).toBe('always');
  });

  it('clears a grant back to ask with null', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(store.setGrant(client, 'sign_event:1', 'always').isOk()).toBe(true);
    expect(store.setGrant(client, 'sign_event:1', null).isOk()).toBe(true);
    expect(useNip46ConnectionsStore.getState().apps[client].grants['sign_event:1']).toBeUndefined();
  });

  it('errors for an unknown app', () => {
    const result = useNip46ConnectionsStore.getState().setGrant(pk(99), 'sign_event:1', 'always');
    expect(result._unsafeUnwrapErr()).toBe('unknown_app');
  });
});

describe('upsertApp', () => {
  it('drops critical-always pairing grants instead of storing them', () => {
    const client = pk(8);
    const result = useNip46ConnectionsStore.getState().upsertApp(
      baseInput(client, {
        grants: {
          'sign_event:1': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 0 },
          nip44_decrypt: { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 0 },
        },
      })
    );
    expect(result.isOk()).toBe(true);

    const grants = useNip46ConnectionsStore.getState().apps[client].grants;
    expect(grants['sign_event:1']?.verdict).toBe('always');
    expect(grants.nip44_decrypt).toBeUndefined();
  });

  it('rejects invalid pubkeys and relay lists with no wss entries', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(store.upsertApp(baseInput('not-a-pubkey'))._unsafeUnwrapErr()).toBe('invalid_pubkey');
    expect(
      store.upsertApp(baseInput(pk(9), { relays: ['https://example.com'] }))._unsafeUnwrapErr()
    ).toBe('invalid_relays');
  });

  it('caps connected apps at 64, while updates to existing apps still pass', () => {
    const store = useNip46ConnectionsStore.getState();
    for (let i = 1; i <= 64; i++) {
      expect(store.upsertApp(baseInput(pk(i))).isOk()).toBe(true);
    }
    expect(Object.keys(useNip46ConnectionsStore.getState().apps)).toHaveLength(64);

    expect(store.upsertApp(baseInput(pk(65)))._unsafeUnwrapErr()).toBe('app_limit_reached');
    expect(store.upsertApp(baseInput(pk(1), { name: 'Renamed' })).isOk()).toBe(true);
    expect(useNip46ConnectionsStore.getState().apps[pk(1)].name).toBe('Renamed');
  });

  it('preserves pairedAt, counters, and prompt grants on re-pair', () => {
    const client = pk(10);
    const store = useNip46ConnectionsStore.getState();
    store.upsertApp(baseInput(client));
    store.setGrant(client, 'sign_event:1', 'always');
    store.touchUsage(client, { denied: true });
    const first = useNip46ConnectionsStore.getState().apps[client];

    store.upsertApp(baseInput(client, { name: 'Re-paired', relays: ['wss://relay.nsec.app'] }));
    const second = useNip46ConnectionsStore.getState().apps[client];
    expect(second.pairedAt).toBe(first.pairedAt);
    expect(second.requestCount).toBe(1);
    expect(second.deniedCount).toBe(1);
    expect(second.grants['sign_event:1']?.verdict).toBe('always');
    expect(second.relays).toEqual(['wss://relay.nsec.app']);
  });
});

describe('app lifecycle actions', () => {
  const client = pk(11);

  beforeEach(() => {
    useNip46ConnectionsStore.getState().upsertApp(baseInput(client, { name: 'Coracle' }));
  });

  it('block, unblock, mode, encryption, rename', () => {
    const store = useNip46ConnectionsStore.getState();
    store.blockApp(client);
    expect(useNip46ConnectionsStore.getState().apps[client].status).toBe('blocked');
    store.unblockApp(client);
    expect(useNip46ConnectionsStore.getState().apps[client].status).toBe('active');

    store.setMode(client, 'strict');
    store.setEncryption(client, 'nip04');
    store.renameApp(client, '  noStrudel  ');
    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app.mode).toBe('strict');
    expect(app.encryption).toBe('nip04');
    expect(app.name).toBe('noStrudel');

    store.renameApp(client, '   ');
    expect(useNip46ConnectionsStore.getState().apps[client].name).toBeUndefined();
  });

  it('touchUsage bumps app counters and grant usage', () => {
    const store = useNip46ConnectionsStore.getState();
    store.setGrant(client, 'sign_event:1', 'always');
    store.touchUsage(client, { grantKey: 'sign_event:1' });
    store.touchUsage(client, { denied: true });

    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app.requestCount).toBe(2);
    expect(app.deniedCount).toBe(1);
    expect(app.lastUsedAt).toBeDefined();
    expect(app.grants['sign_event:1']?.useCount).toBe(1);
    expect(app.grants['sign_event:1']?.lastUsedAt).toBeDefined();
  });

  it('disconnectApp deletes the record', () => {
    useNip46ConnectionsStore.getState().disconnectApp(client);
    expect(useNip46ConnectionsStore.getState().apps[client]).toBeUndefined();
  });

  it('updateMetadataAfterApproval applies sanitized metadata only', () => {
    useNip46ConnectionsStore.getState().updateMetadataAfterApproval(client, {
      name: 'Primal',
      url: 'https://primal.net',
      relays: ['wss://relay.primal.net', 'http://insecure.example'],
    });
    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app.name).toBe('Primal');
    expect(app.url).toBe('https://primal.net');
    expect(app.relays).toEqual(['wss://relay.primal.net']);
  });
});

describe('per-peer decrypt grants', () => {
  const client = pk(20);
  const peerX = 'e'.repeat(64);
  const peerY = 'f'.repeat(64);

  beforeEach(() => {
    expect(useNip46ConnectionsStore.getState().upsertApp(baseInput(client)).isOk()).toBe(true);
  });

  it('sets, merges methods, and revokes per peer', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(
      store.setPeerDecryptGrant(client, peerX, 'nip44_decrypt', { peerIsSelf: false }).isOk()
    ).toBe(true);
    expect(
      store.setPeerDecryptGrant(client, peerX, 'nip04_decrypt', { peerIsSelf: false }).isOk()
    ).toBe(true);
    // Re-granting the same method is idempotent.
    expect(
      store.setPeerDecryptGrant(client, peerX, 'nip44_decrypt', { peerIsSelf: false }).isOk()
    ).toBe(true);

    const grant = useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX];
    expect(grant.methods).toEqual(['nip44_decrypt', 'nip04_decrypt']);

    store.revokePeerDecryptGrant(client, peerX, 'nip44_decrypt');
    expect(
      useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX].methods
    ).toEqual(['nip04_decrypt']);

    store.revokePeerDecryptGrant(client, peerX);
    expect(
      useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX]
    ).toBeUndefined();
  });

  it('lowercases the peer key on write', () => {
    useNip46ConnectionsStore
      .getState()
      .setPeerDecryptGrant(client, peerX.toUpperCase(), 'nip44_decrypt', { peerIsSelf: false });
    expect(useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX]).toBeDefined();
  });

  it('refuses a grant asserting peerIsSelf', () => {
    // Deliberately illegal at the type level — pins the runtime guard.
    const hostileAttestation = { peerIsSelf: true };
    const result = useNip46ConnectionsStore
      .getState()
      .setPeerDecryptGrant(client, peerX, 'nip44_decrypt', hostileAttestation as never);
    expect(result._unsafeUnwrapErr()).toBe('self_decrypt_forbidden');
  });

  it('refuses malformed peers and unknown apps', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(
      store
        .setPeerDecryptGrant(client, 'not-hex', 'nip44_decrypt', { peerIsSelf: false })
        ._unsafeUnwrapErr()
    ).toBe('invalid_peer');
    expect(
      store
        .setPeerDecryptGrant(pk(21), peerX, 'nip44_decrypt', { peerIsSelf: false })
        ._unsafeUnwrapErr()
    ).toBe('unknown_app');
  });

  it('rejects new peers past the per-app cap but still updates existing ones', () => {
    const store = useNip46ConnectionsStore.getState();
    for (let i = 0; i < 50; i++) {
      const peer = i.toString(16).padStart(2, '0').repeat(32);
      expect(
        store.setPeerDecryptGrant(client, peer, 'nip44_decrypt', { peerIsSelf: false }).isOk()
      ).toBe(true);
    }
    const overflowPeer = 'ab'.repeat(32);
    expect(
      store
        .setPeerDecryptGrant(client, overflowPeer, 'nip44_decrypt', { peerIsSelf: false })
        ._unsafeUnwrapErr()
    ).toBe('peer_grant_limit');
    // Adding a second method to an existing peer is still allowed at the cap.
    const existingPeer = '00'.repeat(32);
    expect(
      store.setPeerDecryptGrant(client, existingPeer, 'nip04_decrypt', { peerIsSelf: false }).isOk()
    ).toBe(true);
  });

  it('touchUsage attributes consumption to the peer grant', () => {
    const store = useNip46ConnectionsStore.getState();
    store.setPeerDecryptGrant(client, peerX, 'nip44_decrypt', { peerIsSelf: false });
    store.touchUsage(client, { peerGrantPubkey: peerX });

    const grant = useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX];
    expect(grant.useCount).toBe(1);
    expect(grant.lastUsedAt).toBeDefined();
    expect(
      useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerY]
    ).toBeUndefined();
  });

  it('persists peer grants through the round-trip', async () => {
    const store = useNip46ConnectionsStore.getState();
    store.setPeerDecryptGrant(client, peerX, 'nip44_decrypt', { peerIsSelf: false });
    await flushPersistWrites();

    const blob = storageMap.get(STORAGE_KEY);
    useNip46ConnectionsStore.setState({ apps: {} });
    await flushPersistWrites();
    storageMap.set(STORAGE_KEY, blob!);
    await useNip46ConnectionsStore.persist.rehydrate();

    expect(
      useNip46ConnectionsStore.getState().apps[client].peerDecryptGrants[peerX].methods
    ).toEqual(['nip44_decrypt']);
  });
});

describe('v1 → v2 migration', () => {
  it('hydrates a real v1 blob (no peerDecryptGrants) without wiping pairings', async () => {
    const client = pk(30);
    const v1Connection = persistedConnection(client) as unknown as Record<string, unknown>;
    delete v1Connection.peerDecryptGrants;
    v1Connection.grants = {
      'sign_event:1': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 3 },
    };
    writeBlob({ [client]: v1Connection as unknown as Nip46Connection }, 1);

    await useNip46ConnectionsStore.persist.rehydrate();

    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app).toBeDefined();
    expect(app.peerDecryptGrants).toEqual({});
    expect(app.grants['sign_event:1']?.verdict).toBe('always');
  });

  it('still rejects a v1 blob with a tampered critical-always grant', async () => {
    const client = pk(31);
    const tampered = persistedConnection(client) as unknown as Record<string, unknown>;
    delete tampered.peerDecryptGrants;
    tampered.grants = {
      nip44_decrypt: { verdict: 'always', origin: 'prompt', createdAt: 1, useCount: 0 },
    };
    writeBlob({ [client]: tampered as unknown as Nip46Connection }, 1);

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });
});

describe('adoptConnection', () => {
  const OLD = pk(40);
  const NEW = pk(41);
  const peerX = 'e'.repeat(64);

  function seedPrevious(overrides: Partial<Parameters<typeof baseInput>[1]> = {}) {
    const store = useNip46ConnectionsStore.getState();
    expect(
      store
        .upsertApp(baseInput(OLD, { name: 'Primal', url: 'https://primal.net', ...overrides }))
        .isOk()
    ).toBe(true);
    store.setGrant(OLD, 'sign_event:1', 'always');
    store.setGrant(OLD, 'sign_event:7', 'deny');
    store.setPeerDecryptGrant(OLD, peerX, 'nip44_decrypt', { peerIsSelf: false });
    store.setMode(OLD, 'strict');
    store.touchUsage(OLD);
  }

  it('inheritGrants: true carries config and deletes the old record atomically', () => {
    seedPrevious();
    const before = useNip46ConnectionsStore.getState().apps[OLD];

    const result = useNip46ConnectionsStore
      .getState()
      .adoptConnection(OLD, baseInput(NEW, { name: 'PrimalWeb', url: 'https://primal.net' }), {
        inheritGrants: true,
      });
    expect(result.isOk()).toBe(true);

    const apps = useNip46ConnectionsStore.getState().apps;
    expect(apps[OLD]).toBeUndefined();
    const adopted = apps[NEW];
    expect(adopted).toMatchObject({
      clientPubkey: NEW,
      name: 'PrimalWeb',
      status: 'active',
      mode: 'strict',
      encryption: 'nip44',
      pairedAt: before.pairedAt,
      requestCount: before.requestCount,
      deniedCount: before.deniedCount,
      previousClientPubkeys: [OLD],
    });
    expect(adopted.grants['sign_event:1']?.verdict).toBe('always');
    expect(adopted.grants['sign_event:7']?.verdict).toBe('deny');
    expect(adopted.peerDecryptGrants[peerX]?.methods).toEqual(['nip44_decrypt']);
    expect(adopted.lastUsedAt).toBe(before.lastUsedAt);
  });

  it('inheritGrants: false carries only the attribution chain (blocked fresh start)', () => {
    seedPrevious();
    useNip46ConnectionsStore.getState().blockApp(OLD);

    const result = useNip46ConnectionsStore
      .getState()
      .adoptConnection(OLD, baseInput(NEW), { inheritGrants: false });
    expect(result.isOk()).toBe(true);

    const adopted = useNip46ConnectionsStore.getState().apps[NEW];
    expect(adopted.grants).toEqual({});
    expect(adopted.peerDecryptGrants).toEqual({});
    expect(adopted.mode).toBe('standard');
    expect(adopted.status).toBe('active');
    expect(adopted.requestCount).toBe(0);
    expect(adopted.previousClientPubkeys).toEqual([OLD]);
    expect(useNip46ConnectionsStore.getState().apps[OLD]).toBeUndefined();
  });

  it('merges pairing-time grants on top of carried grants', () => {
    seedPrevious();
    const result = useNip46ConnectionsStore.getState().adoptConnection(
      OLD,
      baseInput(NEW, {
        grants: {
          'sign_event:6': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 0 },
        },
      }),
      { inheritGrants: true }
    );
    expect(result.isOk()).toBe(true);
    const adopted = useNip46ConnectionsStore.getState().apps[NEW];
    expect(adopted.grants['sign_event:1']?.verdict).toBe('always');
    expect(adopted.grants['sign_event:6']?.verdict).toBe('always');
  });

  it('extends and caps the chain, dropping new-key collisions', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(store.upsertApp(baseInput(OLD)).isOk()).toBe(true);
    const longChain = Array.from({ length: 9 }, (_, i) =>
      `${(50 + i).toString(16)}`.padStart(2, '0').repeat(32)
    );
    useNip46ConnectionsStore.setState((state) => ({
      apps: {
        ...state.apps,
        [OLD]: { ...state.apps[OLD], previousClientPubkeys: [...longChain, NEW] },
      },
    }));

    expect(
      useNip46ConnectionsStore
        .getState()
        .adoptConnection(OLD, baseInput(NEW), { inheritGrants: true })
        .isOk()
    ).toBe(true);
    const chain = useNip46ConnectionsStore.getState().apps[NEW].previousClientPubkeys;
    expect(chain).toHaveLength(8);
    expect(chain[chain.length - 1]).toBe(OLD); // most recent kept
    expect(chain).not.toContain(NEW); // collision with live key dropped
  });

  it('rejects self-adopt, unknown previous, and existing target', () => {
    const store = useNip46ConnectionsStore.getState();
    expect(store.upsertApp(baseInput(OLD)).isOk()).toBe(true);
    expect(store.upsertApp(baseInput(NEW)).isOk()).toBe(true);

    expect(
      store.adoptConnection(OLD, baseInput(OLD), { inheritGrants: true })._unsafeUnwrapErr()
    ).toBe('same_pubkey');
    expect(
      store.adoptConnection(pk(42), baseInput(pk(43)), { inheritGrants: true })._unsafeUnwrapErr()
    ).toBe('unknown_previous');
    expect(
      store.adoptConnection(OLD, baseInput(NEW), { inheritGrants: true })._unsafeUnwrapErr()
    ).toBe('target_exists');
  });

  it('succeeds at the connected-app cap (net count unchanged)', () => {
    const store = useNip46ConnectionsStore.getState();
    for (let i = 0; i < 64; i++) {
      expect(store.upsertApp(baseInput(pk(100 + i))).isOk()).toBe(true);
    }
    expect(
      useNip46ConnectionsStore
        .getState()
        .adoptConnection(pk(100), baseInput(pk(200)), { inheritGrants: true })
        .isOk()
    ).toBe(true);
    expect(Object.keys(useNip46ConnectionsStore.getState().apps)).toHaveLength(64);
  });

  it('still drops critical-always entries arriving via input grants', () => {
    seedPrevious();
    const result = useNip46ConnectionsStore.getState().adoptConnection(
      OLD,
      baseInput(NEW, {
        grants: {
          nip44_decrypt: { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 0 },
        },
      }),
      { inheritGrants: true }
    );
    expect(result.isOk()).toBe(true);
    expect(useNip46ConnectionsStore.getState().apps[NEW].grants.nip44_decrypt).toBeUndefined();
  });

  it('persists the chain through the round-trip', async () => {
    seedPrevious();
    useNip46ConnectionsStore
      .getState()
      .adoptConnection(OLD, baseInput(NEW), { inheritGrants: true });
    await flushPersistWrites();

    const blob = storageMap.get(STORAGE_KEY);
    useNip46ConnectionsStore.setState({ apps: {} });
    await flushPersistWrites();
    storageMap.set(STORAGE_KEY, blob!);
    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps[NEW].previousClientPubkeys).toEqual([OLD]);
  });
});

describe('v2 → v3 migration', () => {
  it('hydrates a real v2 blob (no previousClientPubkeys) without wiping pairings', async () => {
    const client = pk(60);
    const v2Connection = persistedConnection(client) as unknown as Record<string, unknown>;
    delete v2Connection.previousClientPubkeys;
    v2Connection.grants = {
      'sign_event:1': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 3 },
    };
    writeBlob({ [client]: v2Connection as unknown as Nip46Connection }, 2);

    await useNip46ConnectionsStore.persist.rehydrate();

    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app).toBeDefined();
    expect(app.previousClientPubkeys).toEqual([]);
    expect(app.grants['sign_event:1']?.verdict).toBe('always');
  });

  it('clamps a malformed chain instead of wiping the blob', async () => {
    const client = pk(61);
    const tampered = persistedConnection(client) as unknown as Record<string, unknown>;
    tampered.previousClientPubkeys = [
      'not-hex',
      ...Array.from({ length: 10 }, (_, i) =>
        `${(70 + i).toString(16)}`.padStart(2, '0').repeat(32)
      ),
    ];
    writeBlob({ [client]: tampered as unknown as Nip46Connection }, 2);

    await useNip46ConnectionsStore.persist.rehydrate();

    const app = useNip46ConnectionsStore.getState().apps[client];
    expect(app).toBeDefined();
    expect(app.previousClientPubkeys).toHaveLength(8);
    expect(app.previousClientPubkeys).not.toContain('not-hex');
  });
});
