/**
 * @jest-environment node
 *
 * The post menu (`usePostActions`) and the block / report / refresh actions
 * behind it (`useModerationActions`): which rows each post offers, and what
 * pressing each row calls (share sheet, clipboard, local hide, block publish,
 * report publish, delete) and tells the person. Both hooks run for real; the
 * popup host, the moderation publishers, the delete hook, the ignore store,
 * the NDK and keys providers, Share and the clipboard are replaced.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useModerationActions } from '@/features/feed/hooks/useModerationActions';
import { usePostActions } from '@/features/feed/hooks/usePostActions';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

type Button = {
  text: string;
  testID?: string;
  description?: string;
  keepOpen?: boolean;
  onPress: (close: () => void) => void;
};
type Menu = { title: string; buttons: Button[] };

const mockMenus: Menu[] = [];
const mockPopup = jest.fn();
const mockSetPersonBlocked = jest.fn();
const mockPublishReport = jest.fn();
const mockSyncMuteList = jest.fn();
const mockDeletePost = jest.fn();
const mockIgnoreEvent = jest.fn();
const mockShare = jest.fn();
const mockCopy = jest.fn();
let mockOwn: string | undefined;
let mockReady = true;
let mockIgnored: string[] = [];

jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: (menu: Menu) => mockMenus.push(menu),
  replaceActionMenuPopup: (menu: Menu) => mockMenus.push(menu),
  popup: (...args: unknown[]) => mockPopup(...args),
}));
jest.mock('@/shared/lib/nostr/moderation', () => {
  class BlockSyncError extends Error {}
  return {
    BlockSyncError,
    setPersonBlocked: (...args: unknown[]) => mockSetPersonBlocked(...args),
    publishReport: (...args: unknown[]) => mockPublishReport(...args),
    syncMuteList: (...args: unknown[]) => mockSyncMuteList(...args),
  };
});
jest.mock('@/features/feed/hooks/useDeletePost', () => ({
  useDeletePost: () => mockDeletePost,
}));
jest.mock('@/features/feed/stores/ignoreStore', () => {
  const store = (select: (s: { ignoreEvent: typeof mockIgnoreEvent }) => unknown) =>
    select({ ignoreEvent: mockIgnoreEvent });
  store.getState = () => ({ ignoredPubkeys: mockIgnored });
  return { useFeedIgnoreStore: store };
});
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  ...jest.requireActual('@nostr-dev-kit/ndk-mobile'),
  useNDK: () => ({ ndk: mockReady ? { id: 'ndk' } : undefined }),
}));
jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  useNostrNDKContext: () => ({ isInitialized: mockReady }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockOwn ? { pubkey: mockOwn } : null }),
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => ['wss://own.example'],
}));
jest.mock('react-native-web/dist/exports/Share', () => ({
  __esModule: true,
  default: { share: (...args: unknown[]) => mockShare(...args) },
}));
jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockCopy(...args),
}));

const ME = 'a1'.repeat(32);
const THEM = 'b2'.repeat(32);
const POST: FeedEvent = {
  id: 'e3'.repeat(32),
  kind: 1,
  pubkey: THEM,
  content: 'hello',
  tags: [],
  created_at: 1_760_000_000,
};

const lastMenu = () => mockMenus[mockMenus.length - 1]!;
const rows = (menu = lastMenu()) => menu.buttons.map((b) => b.testID ?? b.text);

async function press(testID: string) {
  const button = lastMenu().buttons.find((b) => b.testID === testID);
  if (!button) throw new Error(`No ${testID} in ${rows().join(', ')}`);
  const close = jest.fn();
  await act(async () => button.onPress(close));
  return close;
}

function openPostMenu(
  event: FeedEvent = POST,
  getProfileName?: (pk: string) => string | undefined
) {
  const { result } = renderHook(() => usePostActions({ getProfileName }));
  act(() => result.current(event));
  return lastMenu();
}

beforeEach(() => {
  mockMenus.length = 0;
  jest.clearAllMocks();
  mockOwn = ME;
  mockReady = true;
  mockIgnored = [];
  mockSetPersonBlocked.mockResolvedValue(undefined);
  mockPublishReport.mockResolvedValue(undefined);
  mockSyncMuteList.mockResolvedValue(undefined);
});

describe('the post menu', () => {
  it("offers share, copy, hide, block and report on someone else's post", () => {
    const menu = openPostMenu(POST, () => 'Bob');
    expect(menu.title).toBe('Post');
    expect(rows(menu)).toEqual([
      'post-share',
      'post-copy-link',
      'thread-ignore-post',
      'thread-ignore-person',
      'post-report',
    ]);
    expect(menu.buttons.find((b) => b.testID === 'thread-ignore-person')?.description).toBe('Bob');
  });

  it('offers delete instead of block and report on your own post, matching any key case', () => {
    expect(rows(openPostMenu({ ...POST, pubkey: ME.toUpperCase() }))).toEqual([
      'post-share',
      'post-copy-link',
      'thread-ignore-post',
      'post-delete',
    ]);
  });

  it('shares and copies the njump link', async () => {
    openPostMenu();
    const close = await press('post-share');
    expect(close).toHaveBeenCalled();
    const message = mockShare.mock.calls[0][0].message as string;
    expect(message).toMatch(/^https:\/\/njump\.me\/nevent1/);

    openPostMenu();
    await press('post-copy-link');
    expect(mockCopy).toHaveBeenCalledWith(message);
  });

  it('hides the post on this device only', async () => {
    openPostMenu();
    await press('thread-ignore-post');
    expect(mockIgnoreEvent).toHaveBeenCalledWith(POST.id);
    expect(mockSetPersonBlocked).not.toHaveBeenCalled();
  });

  it('blocks the author through the moderation publisher', async () => {
    openPostMenu();
    await press('thread-ignore-person');
    expect(mockSetPersonBlocked).toHaveBeenCalledWith({ id: 'ndk' }, ME, THEM, true);
    expect(mockPopup).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Person blocked', type: 'success' })
    );
  });

  it('asks before deleting, and deletes only from the confirm', async () => {
    openPostMenu({ ...POST, pubkey: ME });
    const close = await press('post-delete');
    expect(close).not.toHaveBeenCalled();
    expect(mockDeletePost).not.toHaveBeenCalled();
    expect(lastMenu().title).toBe('Delete post?');

    await press('post-delete-confirm');
    expect(mockDeletePost).toHaveBeenCalledWith(expect.objectContaining({ id: POST.id }));
  });

  it('reports the post with its id after a reason and a confirm', async () => {
    openPostMenu();
    await press('post-report');
    expect(lastMenu().title).toBe('Report reason');
    expect(rows()).toEqual([
      'report-reason-spam',
      'report-reason-nudity',
      'report-reason-profanity',
      'report-reason-illegal',
      'report-reason-impersonation',
      'report-reason-malware',
      'report-reason-other',
    ]);
    await press('report-reason-spam');
    expect(mockPublishReport).not.toHaveBeenCalled();
    await press('report-publish');

    expect(mockPublishReport).toHaveBeenCalledWith({ id: 'ndk' }, ME, THEM, 'spam', POST.id);
    expect(mockPopup).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Report published to Nostr', type: 'success' })
    );
  });
});

describe('the moderation actions', () => {
  const actions = () => renderHook(() => useModerationActions()).result.current;

  it('refuses to block, report or refresh before the account is ready', async () => {
    mockReady = false;
    const { block, refresh } = actions();
    await act(() => block(THEM, true));
    await act(() => refresh());
    expect(mockSetPersonBlocked).not.toHaveBeenCalled();
    expect(mockSyncMuteList).not.toHaveBeenCalled();
    expect(mockPopup).toHaveBeenCalledWith({ message: 'Account is still loading', type: 'error' });
  });

  it.each([
    [true, 'Blocked on this device'],
    [false, 'Unblocked on this device'],
  ])(
    'says the change stayed on this device when only the sync fails (blocked=%s)',
    async (blocked, message) => {
      const { BlockSyncError } = jest.requireMock('@/shared/lib/nostr/moderation');
      mockSetPersonBlocked.mockRejectedValue(new BlockSyncError('relay'));
      const { block } = actions();
      await act(() => block(THEM, blocked));
      expect(mockPopup).toHaveBeenCalledWith(
        expect.objectContaining({ message, type: 'error', variant: 'toast' })
      );
    }
  );

  it('says the block failed for any other error', async () => {
    mockSetPersonBlocked.mockRejectedValue(new Error('boom'));
    const { block } = actions();
    await act(() => block(THEM, true));
    expect(mockPopup).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Could not block this person', type: 'error' })
    );
  });

  it('refuses a report whose target is not a hex pubkey, without publishing', async () => {
    actions().report('npub1notahexkey');
    await press('report-reason-other');
    await press('report-publish');
    expect(mockPublishReport).not.toHaveBeenCalled();
    expect(mockPopup).toHaveBeenCalledWith({
      message: 'Report could not be published',
      type: 'error',
    });
  });

  it('says so when the report publish fails', async () => {
    mockPublishReport.mockRejectedValue(new Error('no relay'));
    actions().report(THEM);
    await press('report-reason-malware');
    await press('report-publish');
    expect(mockPublishReport).toHaveBeenCalledWith({ id: 'ndk' }, ME, THEM, 'malware', undefined);
    expect(mockPopup).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Report could not be published', type: 'error' })
    );
  });

  it('offers unblock for a blocked person, nothing for yourself', async () => {
    mockIgnored = [THEM];
    const { personMenu } = actions();
    personMenu(THEM);
    expect(rows()).toEqual(['person-menu-unblock', 'person-menu-report']);
    await press('person-menu-unblock');
    expect(mockSetPersonBlocked).toHaveBeenCalledWith({ id: 'ndk' }, ME, THEM, false);

    const before = mockMenus.length;
    personMenu(ME);
    expect(mockMenus).toHaveLength(before);
  });

  it('refreshes the blocked list and reports the outcome', async () => {
    const { refresh } = actions();
    await act(() => refresh());
    expect(mockSyncMuteList).toHaveBeenCalledWith({ id: 'ndk' }, ME);
    expect(mockPopup).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Blocked people updated', type: 'success' })
    );

    mockSyncMuteList.mockRejectedValue(new Error('offline'));
    await act(() => refresh());
    expect(mockPopup).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Could not update blocked people', type: 'error' })
    );
  });
});
