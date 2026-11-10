/**
 * @jest-environment node
 *
 * The full composer's Post button (`PostComposer` → `runComposerPost`): the
 * upload-then-publish sequence, the double-tap guard, what the screen says
 * for each publish outcome, and when it leaves. The screen and the real
 * composer store run; the publish hook (pinned in publishPoll.test.tsx and
 * publishComposed.test.ts), the media uploader, the router and the UI kit are
 * replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { PostComposer } from '@/features/composer/ui/PostComposer';
import { useComposerStore } from '@/features/composer/state/composerStore';

const mockPublish = jest.fn();
const mockUpload = jest.fn();
const mockBack = jest.fn();

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class NDK {},
  useNDK: () => ({ ndk: { signer: {} } }),
}));
jest.mock('@/features/composer/publish/useComposerActions', () => ({
  usePublishNote: () => mockPublish,
}));
jest.mock('@/shared/lib/nostr/media/uploadMediaBlocks', () => ({
  uploadMediaBlocks: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({
  useOwnedMediaStore: { getState: () => ({ recordBlobs: jest.fn() }) },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: (...args: unknown[]) => mockBack(...args), navigate: jest.fn() },
}));
jest.mock('@/features/composer/config/useComposeConfig', () => ({
  useComposeConfig: () => ({ charBudget: 280, maxMedia: 4 }),
}));
jest.mock('react-native-web/dist/exports/TextInput', () => ({
  __esModule: true,
  default: 'MockTextInput',
}));
jest.mock('react-native-web/dist/exports/Keyboard', () => ({
  __esModule: true,
  default: { dismiss: jest.fn(), addListener: () => ({ remove: jest.fn() }) },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-image', () => ({ Image: 'MockImage' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
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
jest.mock('@/shared/hooks/useProfileDisplay', () => ({
  useProfileDisplay: () => ({ pictureResolved: undefined }),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useProfile: () => ({ profile: undefined, status: 'idle' }),
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: jest.fn() }),
  useVisualScrollMetricsLogger: () => ({ onLayout: jest.fn(), onScroll: jest.fn() }),
  useVisualStateLogger: jest.fn(),
}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({
  VisualLayoutProbe: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/features/feed/components/nostr/NoteContent', () => ({
  NoteContent: 'MockNoteContent',
  QuotedPostCard: 'MockQuotedPostCard',
}));
jest.mock('@/features/composer/ui/PollComposeForm', () => ({
  PollComposeForm: 'MockPollComposeForm',
  emptyPollDraft: () => ({ options: [], type: 'singlechoice' }),
}));
jest.mock('@/features/composer/ui/PostProgressBar', () => ({ PostProgressBar: 'MockProgress' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'MockAvatar' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'MockPressable' }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: 'MockSpinner' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'MockText' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

let renderer: TestRenderer.ReactTestRenderer;

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<PostComposer />);
  });
}

const node = (testID: string) => renderer.root.find((n) => n.props.testID === testID);

/** The error line the composer shows, or null. */
function shownError(): string | null {
  const texts = renderer.root.findAll((n) => String(n.type) === 'MockText');
  const error = texts.find((n) => n.props.className === 'mt-3');
  return error ? String(error.props.children) : null;
}

async function draft(text: string, options: { pendingImage?: boolean } = {}) {
  useComposerStore.getState().open({ mode: 'new' });
  const textId = useComposerStore.getState().blocks[0]!.id;
  useComposerStore.getState().setBlockText(textId, text);
  if (options.pendingImage) {
    useComposerStore
      .getState()
      .addMediaBlock({ kind: 'media', mediaKind: 'image', localUri: 'file://a.jpg' });
  }
}

async function pressPost() {
  await act(async () => node('composer-publish').props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPublish.mockResolvedValue('ok');
  mockUpload.mockImplementation(async ({ blocks }: { blocks: unknown[] }) => blocks);
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('posting from the full composer', () => {
  it('uploads pending media, publishes once and goes back on ok', async () => {
    await draft('hello', { pendingImage: true });
    await mount();
    await pressPost();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0].blocks).toEqual([
      expect.objectContaining({ kind: 'media', localUri: 'file://a.jpg' }),
    ]);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockPublish.mock.invocationCallOrder[0]!
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(shownError()).toBeNull();
  });

  it.each([
    ['no-key', 'No signing key available.'],
    ['media-pending', 'Wait for media to finish uploading.'],
    ['empty', 'Write something or add media first.'],
    ['poll-invalid', 'A poll needs a question and at least 2 options.'],
    ['failed', 'Could not publish to any relay. Try again.'],
  ])('stays open and says why for %s', async (outcome, message) => {
    mockPublish.mockResolvedValue(outcome);
    await draft('hello');
    await mount();
    await pressPost();

    expect(mockBack).not.toHaveBeenCalled();
    expect(shownError()).toBe(message);
    expect(node('composer-publish').props.isDisabled).toBe(false);
    expect(useComposerStore.getState().blocks[0]).toMatchObject({ text: 'hello' });
  });

  it.each([
    ['upload-failed', 'Media upload failed. Try again.'],
    ['too-large', 'That file is too large to upload.'],
  ])('publishes nothing when an upload fails (%s)', async (type, message) => {
    mockUpload.mockRejectedValueOnce({ type });
    await draft('hello', { pendingImage: true });
    await mount();
    await pressPost();

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(shownError()).toBe(message);
    expect(node('composer-publish').props.isDisabled).toBe(false);
  });

  it('says nothing when an upload is cancelled', async () => {
    mockUpload.mockRejectedValueOnce({ type: 'canceled' });
    await draft('hello', { pendingImage: true });
    await mount();
    await pressPost();

    expect(mockPublish).not.toHaveBeenCalled();
    expect(shownError()).toBeNull();
  });

  it('publishes once for a double tap', async () => {
    let release!: (outcome: string) => void;
    mockPublish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await draft('hello');
    await mount();
    const onPress = node('composer-publish').props.onPress;
    await act(async () => {
      void onPress();
      void onPress();
    });
    expect(node('composer-publish').props.isDisabled).toBe(true);
    await act(async () => release('ok'));

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('cannot post an empty draft', async () => {
    await draft('   ');
    await mount();
    expect(node('composer-publish').props.isDisabled).toBe(true);
    await pressPost();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('Cancel closes the draft and goes back without publishing', async () => {
    await draft('hello');
    await mount();
    await act(async () => node('composer-cancel').props.onPress());

    expect(useComposerStore.getState().target).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
