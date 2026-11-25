/**
 * The two Remote Login (NIP-46) stores are inert after the signer's removal
 * (ADR 0035), but their saved data must load exactly as the released stores
 * loaded it: kept when valid, rejected whole when tampered, and the activity
 * log pruned to 30 days. Ported from the released stores' own tests.
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
} from '@/shared/stores/profile/nip46ConnectionsStore';
import { useNip46ActivityStore } from '@/shared/stores/profile/nip46ActivityStore';

const { __storageMap: storageMap } = jest.requireMock(
  '@/shared/lib/cashu/profileScopedStorage'
) as { __storageMap: Map<string, string> };

const pk = (index: number) => index.toString(16).padStart(64, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

function connection(clientPubkey: string, grants: Record<string, unknown> = {}) {
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
    grants,
    peerDecryptGrants: {},
    previousClientPubkeys: [],
  };
}

const writeApps = (apps: Record<string, unknown>) =>
  storageMap.set('nip46-connections-store', JSON.stringify({ state: { apps }, version: 1 }));
const writeEntries = (entries: unknown[]) =>
  storageMap.set('nip46-activity-store', JSON.stringify({ state: { entries }, version: 1 }));

beforeEach(() => {
  storageMap.clear();
  useNip46ConnectionsStore.setState({ apps: {} });
  useNip46ActivityStore.setState({ entries: [] });
});

it('holds state only: nothing can write a pairing or an activity row', () => {
  expect(Object.keys(useNip46ConnectionsStore.getState())).toEqual(['apps']);
  expect(Object.keys(useNip46ActivityStore.getState())).toEqual(['entries']);
});

describe('isCriticalGrantKey', () => {
  it.each(['nip04_decrypt', 'nip44_decrypt', 'sign_event:17375', 'sign_event:5'] as const)(
    'classifies %s as critical',
    (key) => expect(isCriticalGrantKey(key)).toBe(true)
  );

  it.each(['sign_event:1', 'sign_event:0', 'sign_event:24133', 'nip44_encrypt'] as const)(
    'classifies %s as grantable',
    (key) => expect(isCriticalGrantKey(key)).toBe(false)
  );
});

describe('the connections a released build saved', () => {
  it('load unchanged', async () => {
    const client = pk(1);
    const app = connection(client, {
      'sign_event:1': { verdict: 'always', origin: 'pairing', createdAt: 1, useCount: 3 },
      nip44_decrypt: { verdict: 'deny', origin: 'prompt', createdAt: 1, useCount: 0 },
    });
    writeApps({ [client]: app });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps[client]).toEqual(app);
  });

  it('default-fill a connection missing peerDecryptGrants', async () => {
    const client = pk(2);
    const { peerDecryptGrants: _omitted, ...partial } = connection(client);
    writeApps({ [client]: partial });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps[client]?.peerDecryptGrants).toEqual({});
  });

  it.each([
    ['an always verdict on nip44_decrypt', 'nip44_decrypt'],
    ['an always verdict on a critical sign kind', 'sign_event:17375'],
    ['an always verdict on a deletion', 'sign_event:5'],
  ])('are rejected whole for %s', async (_label, grantKey) => {
    const client = pk(3);
    writeApps({
      [client]: connection(client, {
        [grantKey]: { verdict: 'always', origin: 'prompt', createdAt: 1, useCount: 0 },
      }),
    });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });

  it('are rejected whole when a record key does not match its clientPubkey', async () => {
    writeApps({ [pk(4)]: connection(pk(5)) });

    await useNip46ConnectionsStore.persist.rehydrate();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
  });
});

describe('the activity a released build saved', () => {
  const entry = (id: string, at: number, overrides: Record<string, unknown> = {}) => ({
    id,
    clientPubkey: 'a'.repeat(64),
    method: 'sign_event',
    kind: 1,
    verdict: 'approved_once',
    at,
    ...overrides,
  });

  it('loads, with entries older than 30 days dropped', async () => {
    const now = Date.now();
    writeEntries([entry('fresh', now - DAY_MS), entry('stale', now - 31 * DAY_MS)]);

    await useNip46ActivityStore.persist.rehydrate();

    expect(useNip46ActivityStore.getState().entries.map((e) => e.id)).toEqual(['fresh']);
  });

  it('drops only a row with a method this build does not know', async () => {
    const now = Date.now();
    writeEntries([entry('known', now), entry('later', now, { method: 'sign_later' })]);

    await useNip46ActivityStore.persist.rehydrate();

    expect(useNip46ActivityStore.getState().entries.map((e) => e.id)).toEqual(['known']);
  });
});
