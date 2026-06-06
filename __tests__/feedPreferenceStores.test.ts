import { normalizeIgnoreHex, useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const hex = (char: string) => char.repeat(64);

describe('feed preference stores', () => {
  beforeEach(() => {
    useFeedIgnoreStore.setState({ ignoredPubkeys: [], ignoredEventIds: [] });
    useNotificationPolicyStore.setState({ policy: 'RELAXED', replyScope: 'DIRECT' });
  });

  it('normalizes ignored pubkeys and event ids', () => {
    expect(normalizeIgnoreHex(` ${hex('A')} `)).toBe(hex('a'));
    expect(normalizeIgnoreHex('npub1abc')).toBeNull();

    const store = useFeedIgnoreStore.getState();
    store.ignorePubkey(hex('b'));
    store.ignorePubkey('invalid');
    store.ignoreEvent(hex('c'));
    store.unignorePubkey(hex('b'));

    expect(useFeedIgnoreStore.getState()).toMatchObject({
      ignoredPubkeys: [],
      ignoredEventIds: [hex('c')],
    });
  });

  it('stores notification policy and reply scope', () => {
    useNotificationPolicyStore.getState().setPolicy('MODERATE');
    useNotificationPolicyStore.getState().setReplyScope('THREAD');
    expect(useNotificationPolicyStore.getState().policy).toBe('MODERATE');
    expect(useNotificationPolicyStore.getState().replyScope).toBe('THREAD');

    useNotificationPolicyStore.getState().resetNotificationPolicy();
    expect(useNotificationPolicyStore.getState().policy).toBe('RELAXED');
    expect(useNotificationPolicyStore.getState().replyScope).toBe('DIRECT');
  });
});
