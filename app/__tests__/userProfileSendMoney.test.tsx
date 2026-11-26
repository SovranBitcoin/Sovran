/**
 * @jest-environment node
 *
 * A profile's Send Money (`startSendMoneyToProfile`, the screen's handler
 * body) addresses the send to that person the same way Send's people search
 * does: with ecash messages on it arms encrypted NIP-17 DM delivery of the
 * token; with them off the person is paid over Lightning only. Replaced: the
 * screen's unrelated imports, as in userProfileFollowToggle.test.tsx.
 */
import { startSendMoneyToProfile } from '@/features/user/screens/UserProfileScreen';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';

let mockEcashMessages = true;

jest.mock('@/shared/config/features', () => ({
  hasFeature: (name: string) => name === 'ecashMessages' && mockEcashMessages,
}));
jest.mock('@/shared/lib/cashu/npc', () => ({ npcAddressForPubkey: () => undefined }));
jest.mock('@/shared/lib/nostr/profileLightningTarget', () => ({
  resolveProfileLightningTarget: async () => null,
  peekCachedLightningTarget: () => null,
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({}));
jest.mock('@/shared/lib/logger', () => {
  // Every export is a silent logger that is also callable (`redactError`, hooks).
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));
// The screen's unrelated imports (navigation, wallet, UI), as in
// userProfileIdentityRow.test.tsx.
jest.mock('expo-router', () => ({}));
jest.mock('wallet/react', () => ({}), { virtual: true });
jest.mock('@/shared/ui/primitives/Pressable', () => ({}));
jest.mock('@/shared/ui/primitives/PressableFeedback', () => ({}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({}));
jest.mock('@/shared/hooks/useSingleFlight', () => ({}));
jest.mock('@/shared/lib/debug/fadeRevealProbe', () => ({}));
jest.mock('@/shared/lib/nostr/client', () => ({}));
jest.mock('@/shared/lib/nostr/publish', () => ({}));
jest.mock('@/shared/ui/composed/Section', () => ({}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({}));
jest.mock('@/shared/lib/url', () => ({}));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({}));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({}));
jest.mock('@/shared/ui/composed/SkeletonExitShimmer', () => ({}));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({}));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({}));
jest.mock('@/runtime/WalletProjection', () => ({}));
jest.mock('@/shared/hooks/useModerationActions', () => ({}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({}));
jest.mock('@/navigation/headerItems', () => ({}));
jest.mock('@/shared/hooks/useNostrProfile', () => ({}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({}));
jest.mock('@/shared/lib/date', () => ({}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({}));
jest.mock('@/shared/lib/nav/profileRoutes', () => ({}));
jest.mock('@/shared/lib/nav/mintInfoRoutes', () => ({}));
jest.mock('@/shared/blocks/OperatorRunsSection', () => ({ OperatorRunsSection: () => null }));
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({}));
jest.mock('@/shared/hooks/useThemeColor', () => ({}));
jest.mock('@/shared/lib/contentShiftLog', () => ({}));

const BOB = 'b4'.repeat(32);
const startSendEcash = jest.fn(async (_opts: unknown) => undefined);
const machine = { startSendEcash } as unknown as Parameters<
  typeof startSendMoneyToProfile
>[0]['machine'];

const send = (over: Partial<Parameters<typeof startSendMoneyToProfile>[0]> = {}) =>
  startSendMoneyToProfile({
    machine,
    pubkey: BOB,
    publishedTarget: 'bob@example.com',
    npcFallback: 'npub1bob@npub.cash',
    waitForProfile: false,
    displayName: 'Bob',
    avatarUrl: 'https://example.com/bob.png',
    nip05: 'bob@example.com',
    isCurrent: () => true,
    ...over,
  });

beforeEach(() => {
  mockEcashMessages = true;
  startSendEcash.mockClear();
  useContactSendStore.getState().clear();
});

describe('Send Money on a profile', () => {
  it('arms encrypted-DM ecash delivery to the person when ecash messages are on', async () => {
    await send();

    expect(useContactSendStore.getState().active).toEqual({
      pubkey: BOB,
      delivery: 'nip17',
      displayName: 'Bob',
      avatarUrl: 'https://example.com/bob.png',
      nip05: 'bob@example.com',
      lud16: 'bob@example.com',
    });
    expect(startSendEcash).toHaveBeenCalledWith(
      expect.objectContaining({ reset: true, recipientPubkey: BOB, meltTarget: 'bob@example.com' })
    );
  });

  it('never offers the npub.cash fallback as their own address', async () => {
    await send({ publishedTarget: null });

    expect(useContactSendStore.getState().active).toMatchObject({ pubkey: BOB, delivery: 'nip17' });
    expect(useContactSendStore.getState().active).not.toHaveProperty('lud16');
    expect(startSendEcash).toHaveBeenCalledWith(
      expect.objectContaining({ meltTarget: 'npub1bob@npub.cash', meltTargetIsNpcFallback: true })
    );
  });

  it('arms nothing with ecash messages off', async () => {
    mockEcashMessages = false;
    await send();

    expect(useContactSendStore.getState().active).toBeNull();
    expect(startSendEcash).toHaveBeenCalledTimes(1);
  });

  it('arms nothing for a tap a newer tap replaced', async () => {
    await send({ isCurrent: () => false });

    expect(useContactSendStore.getState().active).toBeNull();
    expect(startSendEcash).not.toHaveBeenCalled();
  });
});
