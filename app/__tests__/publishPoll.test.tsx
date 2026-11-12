/**
 * @jest-environment node
 *
 * The composer's Post button, `usePublishNote`, with a poll in the draft: what
 * kind:1068 event reaches the publish seam, to which relays and with which
 * acceptance rule, which drafts publish nothing, and what happens to the
 * draft and the person's own-content record afterwards. The real composer
 * store and poll builder run; the NDK hook, the publish seam, the own write
 * relays and the own-content and popup stores are replaced.
 */
import { act, renderHook } from '@testing-library/react-native';
import { errAsync, okAsync } from 'neverthrow';

import { usePublishNote } from '@/features/composer/publish/useComposerActions';
import { useComposerStore } from '@/features/composer/state/composerStore';
import type { ComposerTarget } from '@/features/composer/publish/buildNoteEvent';

type PublishedEvent = { kind: number; content: string; tags: string[][]; created_at: number };

let mockNdk: { signer?: object } | null = { signer: {} };
const mockPublishEvent = jest.fn();
const mockRecordOwn = jest.fn();
const mockNotePublished = jest.fn();

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class NDK {},
  NDKEvent: class NDKEvent {
    kind = 0;
    content = '';
    created_at = 0;
    tags: string[][] = [];
    id = 'signed-id';
    pubkey = 'me';
    sign = jest.fn(async () => {});
  },
  normalizeRelayUrl: (url: string) => url,
  useNDK: () => ({ ndk: mockNdk }),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => ['wss://own-a.example', 'wss://own-b.example'],
}));
jest.mock('@/shared/lib/nostr/outbox/recipientRelays', () => ({
  resolveOutboxRelays: jest.fn(async () => []),
}));
jest.mock('@/shared/stores/profile/ownContentStore', () => ({
  useOwnContentStore: {
    getState: () => ({ recordOwn: mockRecordOwn, confirmOwn: jest.fn(), removeOwn: jest.fn() }),
  },
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({
  useOwnedMediaStore: { getState: () => ({ recordBlobs: jest.fn() }) },
}));
jest.mock('@/shared/lib/popup/popups/notePublished', () => ({
  notePublishedPopup: (...args: unknown[]) => mockNotePublished(...args),
}));

const QUOTED = 'q'.repeat(64);
const PARENT = 'p'.repeat(64);

function draftPoll(
  question: string,
  labels: string[],
  options: {
    target?: ComposerTarget;
    endsAt?: number;
    type?: 'singlechoice' | 'multiplechoice';
  } = {}
) {
  const store = useComposerStore.getState();
  store.open(options.target ?? { mode: 'new' });
  const textId = useComposerStore.getState().blocks[0]!.id;
  useComposerStore.getState().setBlockText(textId, question);
  useComposerStore.getState().setPoll({
    options: labels.map((label, i) => ({ id: `opt${i}`, label })),
    type: options.type ?? 'singlechoice',
    endsAt: options.endsAt,
  });
}

async function post() {
  const { result } = renderHook(() => usePublishNote());
  let outcome: string | undefined;
  await act(async () => {
    outcome = await result.current();
  });
  return outcome;
}

function publishedCall() {
  expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  const call = mockPublishEvent.mock.calls[0][0] as {
    event: PublishedEvent;
    relays: string[];
    resolveOn: string;
  };
  return call;
}

beforeEach(() => {
  mockNdk = { signer: {} };
  mockPublishEvent.mockReset();
  mockPublishEvent.mockReturnValue(okAsync({ accepted: [{ url: 'wss://own-a.example' }] }));
  mockRecordOwn.mockClear();
  mockNotePublished.mockClear();
});

describe('publishing a poll from the composer', () => {
  it('publishes a kind:1068 with the question, labelled options and own relays, then closes', async () => {
    draftPoll('  Lunch?  ', ['Tacos', '  ', 'Ramen'], { endsAt: 1_800_000_000 });

    expect(await post()).toBe('ok');

    const { event, relays, resolveOn } = publishedCall();
    expect(event.kind).toBe(1068);
    expect(event.content).toBe('Lunch?');
    expect(event.tags).toEqual([
      ['option', 'opt0', 'Tacos'],
      ['option', 'opt2', 'Ramen'],
      ['polltype', 'singlechoice'],
      ['endsAt', '1800000000'],
      ['relay', 'wss://own-a.example'],
      ['relay', 'wss://own-b.example'],
    ]);
    expect(relays).toEqual(['wss://own-a.example', 'wss://own-b.example']);
    expect(resolveOn).toBe('all-settled');
    expect(useComposerStore.getState().target).toBeNull();
    // QUIRK: unlike a note, a published poll is not recorded as the person's
    // own content and shows no "published" popup.
    expect(mockRecordOwn).not.toHaveBeenCalled();
    expect(mockNotePublished).not.toHaveBeenCalled();
  });

  it('adds q and p tags when the poll quotes a post', async () => {
    draftPoll('Agree?', ['Yes', 'No'], {
      target: { mode: 'quote', quotedId: QUOTED, quotedPubkey: 'author', relayHint: 'wss://hint' },
      type: 'multiplechoice',
    });

    await post();

    const { event } = publishedCall();
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['polltype', 'multiplechoice'],
        ['q', QUOTED, 'wss://hint', 'author'],
        ['p', 'author'],
      ])
    );
  });

  it('publishes a poll written as a reply with no link to the parent', async () => {
    draftPoll('Which one?', ['A', 'B'], {
      target: { mode: 'reply', parentId: PARENT, parentPubkey: 'parent-author' },
    });

    expect(await post()).toBe('ok');

    // QUIRK: the reply target is ignored, so the poll goes out top-level with
    // no e or p tag for the post it answers (survey defect D1).
    const tagNames = publishedCall().event.tags.map((tag) => tag[0]);
    expect(tagNames).not.toContain('e');
    expect(tagNames).not.toContain('p');
  });

  it('leaves media blocks out of the poll', async () => {
    draftPoll('Pick', ['A', 'B']);
    useComposerStore.getState().addMediaBlock({
      kind: 'media',
      mediaKind: 'image',
      descriptor: { url: 'https://media.example/x.jpg', sha256: 'h', mimeType: 'image/jpeg' },
    });

    expect(await post()).toBe('ok');

    // QUIRK: an uploaded image in a poll draft is dropped from the event.
    expect(publishedCall().event.content).toBe('Pick');
    expect(JSON.stringify(publishedCall().event.tags)).not.toContain('media.example');
  });

  it.each([
    ['an empty question', '   ', ['A', 'B']],
    ['fewer than two labelled options', 'Q?', ['A', ' ']],
  ])('refuses %s and publishes nothing', async (_label, question, labels) => {
    draftPoll(question, labels);

    expect(await post()).toBe('poll-invalid');
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(useComposerStore.getState().target).toEqual({ mode: 'new' });
  });

  it('waits for media still uploading before publishing anything', async () => {
    draftPoll('Q?', ['A', 'B']);
    useComposerStore
      .getState()
      .addMediaBlock({ kind: 'media', mediaKind: 'image', localUri: 'file://pending.jpg' });

    expect(await post()).toBe('media-pending');
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('keeps the draft open when no relay accepts', async () => {
    mockPublishEvent.mockReturnValue(errAsync({ type: 'no-relay-accepted' }));
    draftPoll('Q?', ['A', 'B']);

    expect(await post()).toBe('failed');
    expect(useComposerStore.getState().target).toEqual({ mode: 'new' });
    expect(useComposerStore.getState().poll?.options).toHaveLength(2);
  });

  it('publishes nothing without a signer', async () => {
    mockNdk = { signer: undefined };
    draftPoll('Q?', ['A', 'B']);

    expect(await post()).toBe('no-key');
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe('publishing a note from the composer', () => {
  it('closes the composer only when the note was published', async () => {
    useComposerStore.getState().open({ mode: 'new' });
    const textId = useComposerStore.getState().blocks[0]!.id;
    useComposerStore.getState().setBlockText(textId, 'hello');

    mockPublishEvent.mockReturnValueOnce(errAsync({ type: 'no-relay-accepted' }));
    expect(await post()).toBe('failed');
    expect(useComposerStore.getState().target).toEqual({ mode: 'new' });

    expect(await post()).toBe('ok');
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
    expect(mockPublishEvent.mock.calls[1][0]).toMatchObject({ resolveOn: 'optimistic' });
    expect(useComposerStore.getState().target).toBeNull();
  });
});
