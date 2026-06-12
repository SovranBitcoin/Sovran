/**
 * Pins the re-pair identity matcher: hostname-over-name precedence, the
 * asymmetric url rule (a url-less URI can never name-match a record that has
 * a url — the cheapest impersonation bridge), active-beats-blocked, recency
 * selection, and the previousClientPubkeys attribution resolver.
 */

import type { Nip46Connection } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  connectionForClient,
  findPreviousConnection,
} from '@/features/nostrSigner/lib/connectionMatch';

const pk = (index: number) => index.toString(16).padStart(64, '0');
const NEW_CLIENT = pk(1);

function connection(
  overrides: Partial<Nip46Connection> & { clientPubkey: string }
): Nip46Connection {
  return {
    relays: ['wss://relay.damus.io'],
    origin: 'nostrconnect',
    status: 'active',
    mode: 'standard',
    encryption: 'nip44',
    pairedAt: 1_000,
    requestCount: 0,
    deniedCount: 0,
    grants: {},
    peerDecryptGrants: {},
    previousClientPubkeys: [],
    ...overrides,
  };
}

function appsOf(...connections: Nip46Connection[]): Record<string, Nip46Connection> {
  return Object.fromEntries(connections.map((c) => [c.clientPubkey, c]));
}

describe('findPreviousConnection', () => {
  it('matches by url hostname (case-insensitive)', () => {
    const previous = connection({
      clientPubkey: pk(2),
      name: 'Old Name',
      url: 'https://Primal.net/app',
    });
    const match = findPreviousConnection(appsOf(previous), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
      url: 'https://primal.net',
    });
    expect(match).toEqual({ kind: 'active', connection: previous });
  });

  it('same name with DIFFERENT hostnames never matches (impersonation shape)', () => {
    const previous = connection({
      clientPubkey: pk(2),
      name: 'PrimalWeb',
      url: 'https://primal.net',
    });
    const match = findPreviousConnection(appsOf(previous), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
      url: 'https://evil.example',
    });
    expect(match.kind).toBe('none');
  });

  it('asymmetric rule: a url-less URI cannot name-match a record that has a url', () => {
    const previous = connection({
      clientPubkey: pk(2),
      name: 'PrimalWeb',
      url: 'https://primal.net',
    });
    const match = findPreviousConnection(appsOf(previous), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
    });
    expect(match.kind).toBe('none');
  });

  it('falls back to name equality only when the previous record has no url', () => {
    const previous = connection({ clientPubkey: pk(2), name: '  PrimalWeb ' });
    const match = findPreviousConnection(appsOf(previous), {
      clientPubkey: NEW_CLIENT,
      name: 'primalweb',
      url: 'https://primal.net',
    });
    expect(match).toEqual({ kind: 'active', connection: previous });
  });

  it('an unparseable stored url counts as no url (name fallback allowed)', () => {
    const previous = connection({ clientPubkey: pk(2), name: 'PrimalWeb', url: 'not a url' });
    const match = findPreviousConnection(appsOf(previous), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
    });
    expect(match.kind).toBe('active');
  });

  it('no claimed identity → none', () => {
    const previous = connection({ clientPubkey: pk(2), name: 'PrimalWeb' });
    expect(findPreviousConnection(appsOf(previous), { clientPubkey: NEW_CLIENT }).kind).toBe(
      'none'
    );
    expect(
      findPreviousConnection(appsOf(previous), { clientPubkey: NEW_CLIENT, name: '   ' }).kind
    ).toBe('none');
  });

  it('excludes the parsed clientPubkey itself and bunker-origin records', () => {
    const self = connection({ clientPubkey: NEW_CLIENT, name: 'PrimalWeb' });
    const bunker = connection({ clientPubkey: pk(3), name: 'PrimalWeb', origin: 'bunker' });
    const match = findPreviousConnection(appsOf(self, bunker), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
    });
    expect(match.kind).toBe('none');
  });

  it('active beats blocked; blocked surfaces only when no active match exists', () => {
    const blocked = connection({
      clientPubkey: pk(2),
      name: 'PrimalWeb',
      status: 'blocked',
      lastUsedAt: 9_000,
    });
    const active = connection({ clientPubkey: pk(3), name: 'PrimalWeb', lastUsedAt: 2_000 });

    expect(
      findPreviousConnection(appsOf(blocked, active), {
        clientPubkey: NEW_CLIENT,
        name: 'PrimalWeb',
      })
    ).toEqual({ kind: 'active', connection: active });

    expect(
      findPreviousConnection(appsOf(blocked), { clientPubkey: NEW_CLIENT, name: 'PrimalWeb' })
    ).toEqual({ kind: 'blocked', connection: blocked });
  });

  it('selects the most recent match, falling back to pairedAt when lastUsedAt is missing', () => {
    const older = connection({ clientPubkey: pk(2), name: 'PrimalWeb', lastUsedAt: 1_500 });
    const newer = connection({ clientPubkey: pk(3), name: 'PrimalWeb', pairedAt: 5_000 });
    const match = findPreviousConnection(appsOf(older, newer), {
      clientPubkey: NEW_CLIENT,
      name: 'PrimalWeb',
    });
    expect(match).toEqual({ kind: 'active', connection: newer });
  });
});

describe('connectionForClient', () => {
  it('prefers the live key over a chain entry', () => {
    const live = connection({ clientPubkey: pk(2) });
    const adopter = connection({ clientPubkey: pk(3), previousClientPubkeys: [pk(2)] });
    expect(connectionForClient(appsOf(live, adopter), pk(2))).toBe(live);
  });

  it('resolves a replaced key through the chain', () => {
    const adopter = connection({ clientPubkey: pk(3), previousClientPubkeys: [pk(2), pk(4)] });
    expect(connectionForClient(appsOf(adopter), pk(4))).toBe(adopter);
  });

  it('returns undefined for fully-orphaned keys', () => {
    const adopter = connection({ clientPubkey: pk(3), previousClientPubkeys: [pk(2)] });
    expect(connectionForClient(appsOf(adopter), pk(9))).toBeUndefined();
  });
});
