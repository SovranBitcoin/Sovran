/**
 * @jest-environment node
 *
 * NIP-17 `kind:10050` discovery. The contract that matters is the failure one:
 * every way this can fail returns `[]`, because the caller reads `[]` as
 * "refuse to send" and a thrown error would invite a catch-and-fallback.
 */

import type { Event as NostrEvent } from 'nostr-tools/core';

import { createDmRelayResolver, type DmDiscoveryPool } from '@/shared/lib/nostr/dmRelayDiscovery';
import { DM_RELAY_LIST_KIND } from '@/shared/lib/nostr/outbox/nip17DmRelays';

const pubkey = 'a'.repeat(64);

/** A structurally valid kind:10050 event; only `tags` matters to the parser. */
function dmRelayListEvent(tags: string[][]): NostrEvent {
  return {
    id: 'b'.repeat(64),
    pubkey,
    created_at: 0,
    kind: DM_RELAY_LIST_KIND,
    tags,
    content: '',
    sig: 'c'.repeat(128),
  };
}

function resolverOver(get: DmDiscoveryPool['get']) {
  const destroy = jest.fn();
  const pool = { get: jest.fn(get), destroy };
  const resolve = createDmRelayResolver({
    openPool: () => pool,
    discoveryRelays: ['wss://discovery.example'],
  });
  return { resolve, getMock: pool.get, destroy };
}

describe('createDmRelayResolver', () => {
  it('queries the discovery relays for the pubkey’s kind:10050', async () => {
    const { resolve, getMock } = resolverOver(async () => null);

    await resolve(pubkey);

    const [relays, filter] = getMock.mock.calls[0];
    expect(relays).toEqual(['wss://discovery.example']);
    expect(filter).toEqual({ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] });
  });

  it('returns the relays the recipient declared', async () => {
    const { resolve, destroy } = resolverOver(async () =>
      dmRelayListEvent([['relay', 'wss://inbox.example']])
    );

    await expect(resolve(pubkey)).resolves.toEqual(['wss://inbox.example/']);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the recipient has published no list', async () => {
    const { resolve, destroy } = resolverOver(async () => null);
    await expect(resolve(pubkey)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the list holds no usable relay', async () => {
    const { resolve } = resolverOver(async () => dmRelayListEvent([['relay', 'not a url']]));
    await expect(resolve(pubkey)).resolves.toEqual([]);
  });

  it('returns [] rather than throwing when the lookup itself fails', async () => {
    const { resolve, destroy } = resolverOver(async () => {
      throw new Error('relay unreachable');
    });

    // Not `rejects`: a throw here would reach a caller that has already
    // prepared proofs, and the safe answer to "we don't know" is the same as
    // the answer to "there is no list" — don't send.
    await expect(resolve(pubkey)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
