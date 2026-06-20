/**
 * `publishComposed` — the shared reply/note publish helper used by both the
 * full composer and the sticky thread reply bar. Verifies outcome gating and
 * that the built reply carries NIP-10 tags through to the publish seam.
 */
/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class NDK {},
    NDKEvent: class NDKEvent {
      kind = 0;
      content = '';
      created_at = 0;
      tags: string[][] = [];
    },
    normalizeRelayUrl: (url: string) => url,
    useNDK: () => ({ ndk: null }),
  }),
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => ['wss://write.example'],
}));

jest.mock('@/shared/lib/nostr/outbox/recipientRelays', () => ({
  resolveOutboxRelays: jest.fn(async () => ['wss://write.example']),
}));

jest.mock('@/shared/lib/nostr/publish', () => ({ publishEvent: jest.fn() }));

import { okAsync, errAsync } from 'neverthrow';
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { publishEvent } from '@/shared/lib/nostr/publish';
import { resolveOutboxRelays } from '@/shared/lib/nostr/outbox/recipientRelays';
import { publishComposed } from '@/features/composer/publish/useComposerActions';
import type { ComposerBlock } from '@/features/composer/config/types';

const mockPublishEvent = publishEvent as unknown as jest.Mock;
const mockResolveOutbox = resolveOutboxRelays as unknown as jest.Mock;
const signerNdk = { signer: {} } as unknown as NDK;
const text = (t: string): ComposerBlock => ({ id: 'x', kind: 'text', text: t });

beforeEach(() => {
  mockPublishEvent.mockReset();
  mockPublishEvent.mockReturnValue(okAsync({ accepted: [{ url: 'wss://write.example' }] }));
  mockResolveOutbox.mockClear();
});

describe('publishComposed', () => {
  it('returns no-key without a signer', async () => {
    const out = await publishComposed({} as unknown as NDK, {
      blocks: [text('hi')],
      target: { mode: 'new' },
    });
    expect(out).toBe('no-key');
  });

  it('returns empty for blank text and no media', async () => {
    const out = await publishComposed(signerNdk, {
      blocks: [text('   ')],
      target: { mode: 'new' },
    });
    expect(out).toBe('empty');
  });

  it('returns media-pending when a media block has no descriptor', async () => {
    const blocks: ComposerBlock[] = [
      text('hi'),
      { id: 'm', kind: 'media', mediaKind: 'image', localUri: 'file://x' },
    ];
    const out = await publishComposed(signerNdk, { blocks, target: { mode: 'new' } });
    expect(out).toBe('media-pending');
  });

  it('publishes a reply with NIP-10 tags and returns ok', async () => {
    const out = await publishComposed(signerNdk, {
      blocks: [text('nice post')],
      target: { mode: 'reply', parentId: 'p1', parentPubkey: 'pub1', rootId: 'root1' },
    });
    expect(out).toBe('ok');
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const call = mockPublishEvent.mock.calls[0][0];
    expect(call.event.kind).toBe(1);
    expect(call.event.content).toBe('nice post');
    expect(call.event.tags).toEqual(
      expect.arrayContaining([
        ['e', 'root1', '', 'root'],
        ['e', 'p1', '', 'reply'],
        ['p', 'pub1'],
      ])
    );
    // Optimistic publish; the reply's mention is resolved off the critical path.
    expect(call.resolveOn).toBe('optimistic');
    expect(call.backgroundRelays).toBeInstanceOf(Promise);
    expect(mockResolveOutbox).toHaveBeenCalledTimes(1);
  });

  it('publishes a top-level note to own relays without fetching recipient relays', async () => {
    const out = await publishComposed(signerNdk, {
      blocks: [text('gm')],
      target: { mode: 'new' },
    });
    expect(out).toBe('ok');
    const call = mockPublishEvent.mock.calls[0][0];
    expect(call.resolveOn).toBe('optimistic');
    expect(call.backgroundRelays).toBeUndefined();
    expect(call.relays).toEqual(['wss://write.example']); // own write relays, resolved synchronously
    expect(mockResolveOutbox).not.toHaveBeenCalled(); // no mentions → no network fetch
  });

  it('returns failed when the publish seam errors', async () => {
    mockPublishEvent.mockReturnValue(errAsync({ type: 'all-failed', relayResults: [] }));
    const out = await publishComposed(signerNdk, {
      blocks: [text('hi')],
      target: { mode: 'new' },
    });
    expect(out).toBe('failed');
  });
});
