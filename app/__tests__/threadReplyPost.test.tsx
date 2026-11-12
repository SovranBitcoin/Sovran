/**
 * @jest-environment node
 *
 * The thread reply bar's Reply button (`ThreadReplyBar.handlePost`) and its
 * hand-off to the full composer. The bar and the shared `publishComposed`
 * seam run for real; the NDK hook, the publish seam, the media uploader, the
 * own-content store, the router and the UI kit are replaced.
 *
 * Pinned: what a reply publishes (NIP-10 tags, relays), the optimistic own
 * record and its rollback, what happens to the typed draft on success and on
 * each failure, the double-tap guard, and what Expand / Add poll carry into
 * the composer store.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { errAsync, okAsync } from 'neverthrow';

import { ThreadReplyBar } from '@/features/feed/components/ThreadReplyBar';
import { useComposerStore } from '@/features/composer/state/composerStore';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

let mockNdk: { signer?: object } | null = { signer: {} };
const mockPublishEvent = jest.fn();
const mockRecordOwn = jest.fn();
const mockConfirmOwn = jest.fn();
const mockRemoveOwn = jest.fn();
const mockUpload = jest.fn();
const mockNavigate = jest.fn();
const mockPick = jest.fn();

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class NDK {},
  NDKEvent: class NDKEvent {
    kind = 0;
    content = '';
    created_at = 0;
    tags: string[][] = [];
    id = 'reply-id';
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
  getOwnWriteRelays: () => ['wss://own.example'],
}));
jest.mock('@/shared/lib/nostr/outbox/recipientRelays', () => ({
  resolveOutboxRelays: jest.fn(async () => ['wss://inbox.example']),
}));
jest.mock('@/shared/stores/profile/ownContentStore', () => ({
  useOwnContentStore: {
    getState: () => ({
      recordOwn: mockRecordOwn,
      confirmOwn: mockConfirmOwn,
      removeOwn: mockRemoveOwn,
    }),
  },
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({
  useOwnedMediaStore: { getState: () => ({ recordBlobs: jest.fn() }) },
}));
jest.mock('@/shared/lib/popup/popups/notePublished', () => ({ notePublishedPopup: jest.fn() }));
jest.mock('@/shared/lib/nostr/media/uploadMediaBlocks', () => ({
  uploadMediaBlocks: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: (...args: unknown[]) => mockNavigate(...args), back: jest.fn() },
}));
// The node preset renders react-native-web, whose TextInput needs a DOM.
jest.mock('react-native-web/dist/exports/TextInput', () => ({
  __esModule: true,
  default: 'MockTextInput',
}));
jest.mock('react-native-web/dist/exports/Keyboard', () => ({
  __esModule: true,
  default: { dismiss: jest.fn(), addListener: () => ({ remove: jest.fn() }) },
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-image', () => ({ Image: 'MockImage' }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockPick(...args),
}));
jest.mock('react-native-keyboard-controller', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    KeyboardStickyView: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockSticky', null, children),
    useReanimatedKeyboardAnimation: () => ({ progress: { value: 0 }, height: { value: 0 } }),
  };
});
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Button = (props: React.PropsWithChildren<Record<string, unknown>>) =>
    ReactActual.createElement('MockButton', props, props.children);
  Button.Label = 'MockButtonLabel';
  return { Button };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? 'white' : tokens.map(() => 'white'),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/hooks/useProfileDisplay', () => ({
  useProfileDisplay: () => ({ pictureResolved: undefined }),
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: jest.fn() }),
  useVisualLayoutLogger: () => ({ ref: jest.fn(), onLayout: jest.fn() }),
}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({
  VisualLayoutProbe: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'MockAvatar' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'MockPressable' }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'MockText' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

const ROOT = 'r'.repeat(64);
const PARENT: FeedEvent = {
  id: 'p'.repeat(64),
  kind: 1,
  pubkey: 'author',
  content: 'parent post',
  tags: [
    ['e', ROOT, '', 'root'],
    ['p', 'someone'],
  ],
  created_at: 1_760_000_000,
};

let renderer: TestRenderer.ReactTestRenderer;

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(
      <ThreadReplyBar targetEvent={PARENT} targetProfile={{ name: 'Author' }} />
    );
  });
}

const node = (testID: string) => renderer.root.find((n) => n.props.testID === testID);
const nodes = (prefix: string) =>
  renderer.root.findAll(
    (n) => typeof n.props.testID === 'string' && n.props.testID.startsWith(prefix)
  );

async function type(text: string) {
  await act(async () => node('thread-reply-input').props.onChangeText(text));
}

async function addPickedImage() {
  await act(async () => node('thread-reply-input').props.onFocus());
  mockPick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file://photo.jpg', mimeType: 'image/jpeg', width: 10, height: 10 }],
  });
  await act(async () => node('thread-reply-add-media').props.onPress());
}

async function pressReply() {
  await act(async () => node('thread-reply-post').props.onPress());
}

const publishedEvent = (call = 0) =>
  mockPublishEvent.mock.calls[call][0] as {
    event: { kind: number; content: string; tags: string[][] };
    relays: string[];
    resolveOn: string;
  };

beforeEach(() => {
  jest.clearAllMocks();
  mockNdk = { signer: {} };
  mockPublishEvent.mockReturnValue(okAsync({ accepted: [{ url: 'wss://own.example' }] }));
  mockUpload.mockImplementation(async ({ blocks }: { blocks: unknown[] }) =>
    (blocks as Record<string, unknown>[]).map((b) => ({
      ...b,
      descriptor: { url: 'https://media.example/x.jpg', sha256: 'h', mimeType: 'image/jpeg' },
    }))
  );
  useComposerStore.getState().open({ mode: 'new' });
  useComposerStore.getState().close();
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('posting a reply from the thread reply bar', () => {
  it('publishes a NIP-10 reply, records it optimistically, confirms it and clears the bar', async () => {
    await mount();
    await type('  nice post  ');
    await pressReply();

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const { event, relays, resolveOn } = publishedEvent();
    expect(event.kind).toBe(1);
    // QUIRK: the reply is published with the whitespace it was typed with.
    expect(event.content).toBe('  nice post  ');
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['e', ROOT, 'wss://own.example', 'root'],
        ['e', PARENT.id, 'wss://own.example', 'reply'],
        ['p', 'author'],
        ['p', 'someone'],
      ])
    );
    expect(relays).toEqual(['wss://own.example']);
    expect(resolveOn).toBe('optimistic');
    expect(mockRecordOwn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reply-id', content: '  nice post  ' }),
      'pending'
    );
    expect(mockConfirmOwn).toHaveBeenCalledWith('reply-id');
    expect(node('thread-reply-input').props.value).toBe('');
  });

  it('keeps the typed reply and says nothing when no relay accepts', async () => {
    mockPublishEvent.mockReturnValue(errAsync({ type: 'no-relay-accepted' }));
    await mount();
    await type('hello');
    await pressReply();

    expect(mockRecordOwn).toHaveBeenCalledTimes(1);
    expect(mockRemoveOwn).toHaveBeenCalledWith('reply-id');
    expect(mockConfirmOwn).not.toHaveBeenCalled();
    expect(node('thread-reply-input').props.value).toBe('hello');
    expect(node('thread-reply-post').props.isDisabled).toBe(false);
    // QUIRK: the bar shows no error for a failed reply (survey defect D3):
    // nothing in the rendered tree carries an error message.
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/relay|try again|failed/i);
  });

  it('publishes nothing and keeps the draft when an image upload fails', async () => {
    mockUpload.mockRejectedValueOnce({ type: 'upload-failed' });
    await mount();
    await type('with a photo');
    await addPickedImage();
    await pressReply();

    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockRecordOwn).not.toHaveBeenCalled();
    expect(node('thread-reply-input').props.value).toBe('with a photo');
    expect(nodes('thread-reply-remove-media-')).toHaveLength(1);
    expect(node('thread-reply-post').props.isDisabled).toBe(false);
  });

  it('uploads a picked image first and publishes it with an imeta tag', async () => {
    await mount();
    await addPickedImage();
    await pressReply();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(publishedEvent().event.tags.some((tag) => tag[0] === 'imeta')).toBe(true);
    expect(nodes('thread-reply-remove-media-')).toHaveLength(0);
  });

  it('publishes once for a double tap', async () => {
    let release!: () => void;
    mockUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        })
    );
    await mount();
    await type('once');
    const onPress = node('thread-reply-post').props.onPress;
    await act(async () => {
      void onPress();
      void onPress();
    });
    await act(async () => release());

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });

  it('offers Reply only once there is something to post', async () => {
    await mount();
    await act(async () => node('thread-reply-input').props.onFocus());
    expect(node('thread-reply-post').props.isDisabled).toBe(true);
    await type('   ');
    expect(node('thread-reply-post').props.isDisabled).toBe(true);
    await type('x');
    expect(node('thread-reply-post').props.isDisabled).toBe(false);
  });
});

describe('handing the reply to the full composer', () => {
  it('Expand opens the composer as a reply with the typed text and picked media, and clears the bar', async () => {
    await mount();
    await type('draft');
    await addPickedImage();
    await act(async () => node('thread-reply-expand').props.onPress());

    const state = useComposerStore.getState();
    expect(state.target).toMatchObject({ mode: 'reply', parentId: PARENT.id, rootId: ROOT });
    expect(state.parentEvent).toBe(PARENT);
    expect(state.blocks).toEqual([
      expect.objectContaining({ kind: 'text', text: 'draft' }),
      expect.objectContaining({ kind: 'media', localUri: 'file://photo.jpg' }),
    ]);
    expect(state.poll).toBeUndefined();
    expect(mockNavigate).toHaveBeenCalledWith('/composer');
    expect(node('thread-reply-input').props.value).toBe('');
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('Add poll opens the composer as a reply with an empty poll', async () => {
    await mount();
    await type('question');
    await act(async () => node('thread-reply-input').props.onFocus());
    await act(async () => node('thread-reply-add-poll').props.onPress());

    const state = useComposerStore.getState();
    expect(state.target).toMatchObject({ mode: 'reply', parentId: PARENT.id });
    expect(state.poll).toBeDefined();
    expect(mockNavigate).toHaveBeenCalledWith('/composer');
  });
});
