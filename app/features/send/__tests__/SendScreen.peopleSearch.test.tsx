/**
 * @jest-environment jsdom
 *
 * Regression for the unified Send People search:
 *  - live search results render via the canonical ContactRow (metrics parity) and
 *    a tap starts a PAYMENT (never profile navigation);
 *  - recent people (searched / sent / received / Nut Drop peers, via
 *    useQuickPayPeople) show at REST and while focused-empty, and are replaced by
 *    live results once the user types;
 *  - the trailing button is Paste at rest and Cancel once focused (clear + unfocus).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SendScreen } from '@/features/send/screens/SendScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Controllable data sources (read lazily inside the mocked hooks) ──────────
let mockContactRows: {
  type: 'contact';
  id: string;
  pubkey: string;
  profile?: Record<string, unknown>;
  isLoadingProfile: boolean;
  score: number;
}[] = [];
let mockLoading = false;
let mockQuickPay: {
  pubkey: string;
  source: string;
  displayName: string;
  picture: string | null;
  lud16: string | null;
  nip05: string | null;
  isLoading: boolean;
}[] = [];
let mockFreshPeers: { peerID: string; pubkey: string }[] = [];

const mockStartSendEcash = jest.fn();
const mockContactStart = jest.fn();
const mockContactClear = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: () => ({
    scan: jest.fn(),
    execute: jest.fn(),
    startSendEcash: mockStartSendEcash,
  }),
}));

// Name queries aren't payable destinations → no DetectedActionRow.
jest.mock('wallet', () => ({
  parsePaymentInput: (input: string) => ({ input }),
  defaultDetectors: {},
  describeDestination: () => ({ kind: 'unsupported' }),
}));

jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const View = ({ children, ...props }: { children?: React.ReactNode }) =>
    R.createElement('Animated.View', props, children);
  return {
    __esModule: true,
    default: { View },
    Easing: { inOut: (fn: unknown) => fn, cubic: () => 0 },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: () => 0,
    useAnimatedStyle: () => ({}),
    useSharedValue: (v: number) => ({ value: v }),
    withTiming: (v: number) => v,
  };
});

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (c: string) => c,
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/shared/providers/WalletContextProvider', () => ({ useWalletContext: () => ({}) }));
jest.mock('@/features/camera', () => ({
  useHandleCameraPermission: () => ({ handlePermission: jest.fn().mockResolvedValue(true) }),
}));
jest.mock('@/features/bitchat/hooks/useBLEPeers', () => ({ useBLEPeers: () => ({ peers: [] }) }));
jest.mock('@/features/bitchat/lib/blePeerSnapshots', () => ({
  BLE_PEER_FRESHNESS_TICK_MS: 1_000_000,
  filterFreshBLEPeers: () => mockFreshPeers,
}));
jest.mock('@/features/nearPay/lib/peerProfile', () => ({
  peerDisplayName: () => 'Peer',
  peerIdentitySeed: (p: { peerID: string }) => p.peerID,
  peerNostrPubkey: (p: { pubkey: string }) => p.pubkey,
}));
jest.mock('@/features/nearPay/hooks/useRememberPeers', () => ({ useRememberPeers: () => {} }));
jest.mock('@/features/contacts/hooks/useOverlaidContactSearch', () => ({
  useOverlaidContactSearch: () => ({ contactRows: mockContactRows, loading: mockLoading }),
  CONTACT_SEARCH_MIN_LENGTH: 3,
}));
jest.mock('@/features/send/hooks/useQuickPayPeople', () => ({
  useQuickPayPeople: () => mockQuickPay,
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({ clearPaymentContext: () => {} }));
jest.mock('@/shared/stores/runtime/contactSendStore', () => ({
  useContactSendStore: Object.assign(() => {}, {
    getState: () => ({ clear: mockContactClear, start: mockContactStart }),
  }),
}));
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({
  normalizeRecentPersonPubkey: (k: string) => k,
}));
jest.mock('@/shared/lib/nfc', () => ({ useNfcSupported: () => false }));
jest.mock('@/shared/stores/runtime/nfcTapStore', () => ({
  useNfcTapStore: (sel: (s: { armed: boolean }) => unknown) => sel({ armed: false }),
}));
jest.mock('@/shared/lib/popup', () => ({ showActionSheet: () => {} }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- test mock needs real hex
    Array.isArray(tokens) ? tokens.map(() => '#000000') : '#000000',
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

const stub =
  (name: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, children);
  };

jest.mock('@/shared/ui/composed/ListRow', () => ({ ListRow: stub('ListRow') }));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: stub('ContactRow'),
  nostrIdentity: (pubkey: string, profile: unknown, opts: unknown) => ({
    kind: 'nostr',
    pubkey,
    profile,
    ...(opts as object),
  }),
}));
jest.mock('@/shared/ui/composed/Screen', () => ({ useScreenOptions: () => {} }));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({
  CircleActionButton: stub('CircleActionButton'),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: stub('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: stub('View') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: stub('VStack') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));
jest.mock('@/features/send/components/DetectedActionRow', () => ({
  DetectedActionRow: () => null,
}));

function renderSend() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<SendScreen unit="sat" />);
  });
  return renderer;
}
// First instance carrying the testID — the mocked-component/host pair share props,
// so [0] reliably exposes the handlers/value SendScreen passed.
function nodeByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll((n) => n.props.testID === testID)[0];
}
function type(renderer: TestRenderer.ReactTestRenderer, value: string) {
  act(() => {
    nodeByTestID(renderer, 'send-destination-input').props.onChangeText(value);
  });
}
function focus(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    nodeByTestID(renderer, 'send-destination-input').props.onFocus();
  });
}
function press(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  act(() => {
    nodeByTestID(renderer, testID).props.onPress();
  });
}
// Only the host 'ContactRow' element (string type), not the mocked component
// instance that also carries the same testID prop.
function contactNode(renderer: TestRenderer.ReactTestRenderer, pubkey: string) {
  return renderer.root.findAll(
    (n) => String(n.type) === 'ContactRow' && n.props.testID === `send-contact:${pubkey}`
  );
}
function has(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll((n) => n.props.testID === testID).length > 0;
}
function hasText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll((n) => n.props.children === text).length > 0;
}

const CALLE = {
  type: 'contact' as const,
  id: 'contact:pkcalle',
  pubkey: 'pkcalle',
  profile: {
    displayName: 'Calle',
    picture: 'https://x/p.png',
    nip05: 'calle@nostr',
    lud16: 'calle@ln',
    score: 2100,
    followers: 2000,
  },
  isLoadingProfile: false,
  score: 100,
};
const REC = {
  pubkey: 'pkrec',
  source: 'sent',
  displayName: 'Rec',
  picture: null,
  lud16: 'rec@ln',
  nip05: 'rec@nostr',
  isLoading: false,
};

describe('SendScreen — People search unified with wallet/feed', () => {
  beforeEach(() => {
    mockContactRows = [];
    mockLoading = false;
    mockQuickPay = [];
    mockFreshPeers = [];
    mockStartSendEcash.mockReset();
    mockContactStart.mockReset();
    mockContactClear.mockReset();
    mockRouterPush.mockReset();
    mockRouterNavigate.mockReset();
  });

  it('renders a live result via the canonical ContactRow with the metrics-bearing profile', () => {
    mockContactRows = [CALLE];
    const renderer = renderSend();
    type(renderer, 'calle');

    const rows = contactNode(renderer, 'pkcalle');
    expect(rows).toHaveLength(1);
    expect(rows[0].props.identity).toMatchObject({
      kind: 'nostr',
      pubkey: 'pkcalle',
      profile: expect.objectContaining({ lud16: 'calle@ln', followers: 2000 }),
      isLoadingProfile: false,
    });
  });

  it('a People tap starts a payment (contactSendStore + startSendEcash w/ meltTarget), not profile nav', () => {
    mockContactRows = [CALLE];
    const renderer = renderSend();
    type(renderer, 'calle');

    act(() => {
      contactNode(renderer, 'pkcalle')[0].props.onPress();
    });
    expect(mockContactStart).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: 'pkcalle', lud16: 'calle@ln' })
    );
    expect(mockStartSendEcash).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPubkey: 'pkcalle', meltTarget: 'calle@ln' })
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  it('paints skeleton rows while loading and does not flash "No people found"', () => {
    mockLoading = true;
    mockContactRows = [
      {
        type: 'contact',
        id: 'contact:placeholder-0',
        pubkey: 'placeholder-0',
        isLoadingProfile: true,
        score: 100,
      },
      {
        type: 'contact',
        id: 'contact:placeholder-1',
        pubkey: 'placeholder-1',
        isLoadingProfile: true,
        score: 99,
      },
    ];
    const renderer = renderSend();
    type(renderer, 'cal');

    const skeleton = contactNode(renderer, 'placeholder-0');
    expect(skeleton).toHaveLength(1);
    expect(skeleton[0].props.identity.isLoadingProfile).toBe(true);
    expect(skeleton[0].props.onPress).toBeUndefined();
    expect(hasText(renderer, 'No people found')).toBe(false);
  });

  it('shows the empty state only when a real search returns nothing', () => {
    mockContactRows = [];
    mockLoading = false;
    const renderer = renderSend();
    type(renderer, 'zzzznope');
    expect(hasText(renderer, 'No people found')).toBe(true);
  });

  it('shows recent people AT REST (unfocused, empty query), tappable into the payment seam', () => {
    mockQuickPay = [REC];
    const renderer = renderSend(); // no focus, no query

    const rows = contactNode(renderer, 'pkrec');
    expect(rows).toHaveLength(1);
    act(() => {
      rows[0].props.onPress();
    });
    expect(mockStartSendEcash).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPubkey: 'pkrec', meltTarget: 'rec@ln' })
    );
  });

  it('keeps recents visible when focused-empty, and replaces them with live results when typing', () => {
    mockQuickPay = [REC];
    mockContactRows = [CALLE];
    const renderer = renderSend();

    focus(renderer); // focused, empty → recents remain
    expect(contactNode(renderer, 'pkrec')).toHaveLength(1);
    expect(contactNode(renderer, 'pkcalle')).toHaveLength(0);

    type(renderer, 'calle'); // typing → live People replace recents
    expect(contactNode(renderer, 'pkcalle')).toHaveLength(1);
    expect(contactNode(renderer, 'pkrec')).toHaveLength(0);
  });

  it('drops a person already pinned in the Nearby tier from live People results', () => {
    mockFreshPeers = [{ peerID: 'peer1', pubkey: 'pkdup' }];
    mockContactRows = [{ ...CALLE, id: 'contact:pkdup', pubkey: 'pkdup' }];
    const renderer = renderSend();
    type(renderer, 'dup');
    expect(contactNode(renderer, 'pkdup')).toHaveLength(0);
  });

  it('shows Cancel only when the input has content; Cancel clears + restores Paste', () => {
    const renderer = renderSend();
    expect(has(renderer, 'send-paste')).toBe(true);
    expect(has(renderer, 'send-cancel')).toBe(false);

    focus(renderer); // focused but EMPTY → still Paste (not Cancel)
    expect(has(renderer, 'send-paste')).toBe(true);
    expect(has(renderer, 'send-cancel')).toBe(false);

    type(renderer, 'calle'); // content typed → Cancel appears
    expect(has(renderer, 'send-cancel')).toBe(true);
    expect(has(renderer, 'send-paste')).toBe(false);

    press(renderer, 'send-cancel');
    // Cleared query → input emptied, back to Paste.
    expect(nodeByTestID(renderer, 'send-destination-input').props.value).toBe('');
    expect(has(renderer, 'send-paste')).toBe(true);
    expect(has(renderer, 'send-cancel')).toBe(false);
  });
});
