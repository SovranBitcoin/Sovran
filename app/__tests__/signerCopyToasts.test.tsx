/**
 * The signer's three copy buttons (the event id in an activity entry, the raw
 * event under an approval card, the pairing link on Share Remote Login) say
 * "Copied" only once the clipboard has the text, and "Failed to copy" when
 * the write was refused.
 *
 * Everything a screen draws with is replaced by a host element; the copy
 * handlers are the real ones.
 */
import TestRenderer, { act } from 'react-test-renderer';

import { ExpandableEventJson } from '@/features/nostrSigner/components/SummaryPreviewCards';
import { ShareSignerScreen } from '@/features/nostrSigner/screens/ShareSignerScreen';
import { SignerActivityDetailScreen } from '@/features/nostrSigner/screens/SignerActivityDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_ID = 'e'.repeat(64);
const mockEntry = {
  id: 'entry-1',
  clientPubkey: 'c'.repeat(64),
  method: 'sign_event',
  kind: 1,
  verdict: 'approved',
  at: 1_700_000_000,
  eventId: EVENT_ID,
};

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ popup: jest.fn(), staticPopup: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'entry-1' }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('heroui-native', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const host = (name: string) => (props: Record<string, unknown>) => createElement(name, props);
  return {
    Button: Object.assign(host('HerouiButton'), { Label: host('HerouiButton.Label') }),
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('ListGroup.Item'),
      ItemContent: host('ListGroup.ItemContent'),
    }),
    Separator: 'Separator',
  };
});
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: 'QRCode' }));
jest.mock('react-native-gesture-handler', () => ({ ScrollView: 'GestureScrollView' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: 'Icon' }));
jest.mock('@/features/nostrSigner/components/permissionCatalog', () => ({
  ACTIVITY_VERDICT_DISPLAY: new Proxy({}, { get: () => ({ label: 'Approved' }) }),
  appDisplayName: () => 'App',
  permissionEntryFor: () => ({ headline: 'Sign', permissionEditorLabel: 'Note' }),
  encryptedPayloadLabel: () => 'Encrypted',
}));
jest.mock('@/features/nostrSigner/data/nip46ActivityStore', () => ({
  useNip46ActivityStore: (select: (state: unknown) => unknown) => select({ entries: [mockEntry] }),
}));
jest.mock('@/features/nostrSigner/data/nip46ConnectionsStore', () => ({
  useNip46ConnectionsStore: (select: (state: unknown) => unknown) => select({ apps: [] }),
}));
jest.mock('@/features/nostrSigner/data/nip46RequestsStore', () => ({
  useNip46RequestsStore: { getState: () => ({ setServiceHotRequested: jest.fn() }) },
}));
jest.mock('@/features/nostrSigner/lib/connectionMatch', () => ({
  connectionForClient: () => undefined,
}));
jest.mock('@/features/nostrSigner/lib/bunkerSecrets', () => {
  const { okAsync } = jest.requireActual<typeof import('neverthrow')>('neverthrow');
  return { mintSecret: () => okAsync('one-time-secret'), clearSecrets: () => okAsync(undefined) };
});
jest.mock('@/features/nostrSigner/lib/nip46Uri', () => ({
  buildBunkerUri: () => 'bunker://signer?secret=one-time-secret',
}));
jest.mock('@/features/nostrSigner/hooks/useReferencedEventPreview', () => ({
  useReferencedEventPreview: () => ({ status: 'loading' }),
}));
jest.mock('@/shared/hooks/useNostrPersonDisplay', () => ({ useNostrPersonDisplay: () => ({}) }));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadataMany: () => ({}),
}));
jest.mock('@/shared/lib/imageLoadState', () => ({ avatarStateFor: () => 'fallback' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => 'rgb(128, 128, 128)'),
}));
jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'date', formatRelative: () => 'now' }));
jest.mock('@/shared/lib/logger', () => ({ nostrLog: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('@/shared/ndk', () => ({ relays: ['wss://relay.example'] }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'a'.repeat(64) } }),
}));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: 'LoadingIndicator' }));
jest.mock('@/shared/ui/composed/ListRow', () => ({ ListRow: 'ListRow' }));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: 'Screen', useScreenOptions: jest.fn() }));
jest.mock('@/shared/ui/composed/Section', () => ({ Section: 'Section' }));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: 'SkeletonContentCrossfade',
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: 'HStack' }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: 'Spacer' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'VStack' }));

const { setStringAsync } = jest.requireMock<{ setStringAsync: jest.Mock }>('expo-clipboard');
const { popup, staticPopup } = jest.requireMock<{ popup: jest.Mock; staticPopup: jest.Mock }>(
  '@/shared/lib/popup'
);

let renderer: TestRenderer.ReactTestRenderer;
const press = (testID: string) =>
  act(async () => {
    await renderer.root.findAllByProps({ testID })[0].props.onPress();
  });

/** Tap copy with the clipboard held, then let it finish, then tap again with it refusing. */
async function expectCopiedOnlyAfterTheWrite(testID: string, text: string) {
  let finish!: () => void;
  setStringAsync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  // Not awaited to the end of the write: the handler may wait on it.
  await act(async () => {
    void renderer.root.findAllByProps({ testID })[0].props.onPress();
  });
  expect(setStringAsync).toHaveBeenLastCalledWith(text);
  expect(popup).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(popup).toHaveBeenCalledWith(expect.objectContaining({ message: 'Copied' }));
  expect(staticPopup).not.toHaveBeenCalled();

  popup.mockClear();
  setStringAsync.mockRejectedValueOnce(new Error('clipboard unavailable'));
  await press(testID);
  expect(popup).not.toHaveBeenCalled();
  expect(staticPopup).toHaveBeenCalledWith('copy-failed');
}

beforeEach(() => {
  jest.clearAllMocks();
  setStringAsync.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it('the event id in a signer activity entry', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<SignerActivityDetailScreen />);
  });
  await press('signer-activity-technical-details');

  await expectCopiedOnlyAfterTheWrite(`signer-activity-copy-event-id-${EVENT_ID}`, EVENT_ID);
});

it('the raw event under an approval card', async () => {
  const event = { kind: 1, content: 'hello', tags: [], created_at: 1 };
  await act(async () => {
    renderer = TestRenderer.create(<ExpandableEventJson event={event} />);
  });
  await press('signer-event-json-toggle');

  await expectCopiedOnlyAfterTheWrite('signer-event-json-copy', JSON.stringify(event, null, 2));
});

it('the pairing link on Share Remote Login', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<ShareSignerScreen />);
  });

  await expectCopiedOnlyAfterTheWrite(
    'share-signer-copy-link',
    'bunker://signer?secret=one-time-secret'
  );
});
