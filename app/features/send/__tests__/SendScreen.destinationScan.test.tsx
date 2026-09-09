/**
 * @jest-environment jsdom
 *
 * Regression: every destination-entry path on the Send screen must funnel
 * through the ONE canonical `machine.scan` entry (identical parse, dedup, and
 * `'paste'` source tagging) — never `machine.execute` directly, which bypasses
 * scan's dedup and leaves the source untagged (mislabeled `'qr'` downstream).
 *
 * Guards the fix that unified the Paste button, keyboard-submit, and the
 * detected-action row so pasting behaves exactly like a scan.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SendScreen } from '@/features/send/screens/SendScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Shared mock machine (recreated per test) ────────────────────────────────
const mockScan = jest.fn();
const mockExecute = jest.fn();
const mockStartSendEcash = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: () => ({
    scan: mockScan,
    execute: mockExecute,
    startSendEcash: mockStartSendEcash,
  }),
}));

// `describeDestination` returns a protocol (non-person) descriptor for any
// whitespace-free input so the DetectedActionRow renders with `onExecute`.
jest.mock('wallet', () => ({
  parsePaymentInput: (input: string) => ({ input }),
  defaultDetectors: {},
  describeDestination: (parsed: { input: string }) => ({
    kind: 'lightningInvoice',
    raw: parsed.input,
    label: 'Pay 100 sats',
    icon: 'lightning',
    action: 'meltInvoice',
    amount: null,
    hasAlternatives: false,
  }),
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
  filterFreshBLEPeers: () => [],
}));
jest.mock('@/features/nearPay/lib/peerProfile', () => ({
  peerDisplayName: () => '',
  peerIdentitySeed: () => '',
  peerNostrPubkey: () => null,
}));
jest.mock('@/features/nearPay/hooks/useRememberPeers', () => ({ useRememberPeers: () => {} }));
jest.mock('@/features/contacts/hooks/useOverlaidContactSearch', () => ({
  useOverlaidContactSearch: () => ({ contactRows: [], loading: false }),
  CONTACT_SEARCH_MIN_LENGTH: 3,
}));
jest.mock('@/features/send/hooks/useQuickPayPeople', () => ({ useQuickPayPeople: () => [] }));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({ clearPaymentContext: () => {} }));
jest.mock('@/shared/stores/runtime/contactSendStore', () => ({
  useContactSendStore: Object.assign(() => {}, {
    getState: () => ({ clear: jest.fn(), start: jest.fn() }),
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
  guardedRouter: { navigate: jest.fn(), push: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- test mock needs real hex
    Array.isArray(tokens) ? tokens.map(() => '#000000') : '#000000',
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

// Lightweight element stubs so the tree renders without native chrome.
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

// DetectedActionRow's own routing is covered by DetectedActionRow.test.tsx.
// Here we only need to exercise SendScreen's `onExecute` wiring, so expose it.
jest.mock('@/features/send/components/DetectedActionRow', () => ({
  DetectedActionRow: ({ onExecute }: { onExecute: () => void }) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement('DetectedActionRow', { testID: 'detected-row', onPress: onExecute });
  },
}));

const TOKEN = 'lnbc100n1exampleinvoice';
// A long multi-option BIP-321 (lightning invoice + creq). The row must hand the
// machine the FULL string untruncated, so `machine.scan` re-parses both options
// and shows the same chooser as the Paste button. Regression for "tapping the
// detected row doesn't open the payment selector".
const BIP321_MULTI =
  'bitcoin:?lightning=lnbc1u1p4yg4fqpp5rc6l26aafjxqelzkyvgzkgrgjpnx0e7r53gwudjysyh4py694n9qdpdfe6k6meq2p84xgrsv9uk6etwwssx7e3qxycrqgrnv968xcqzzsxqyz5vq&creq=CREQB1QYQQSERYX56NYD3EVSPQQZQQQQQQQQQQQPJQXQQPQQZQQQGPQ5QZY6R5W3C8XW309AKKJMN59EKKJMNFVF5HGUEWVDSHX6P0GF5HGCM0D9HQ2QQADP68GURN8GHJ7MTFDE6ZUCMGDAE82UEWVDHK6MT4DE5HG7G9';

function byTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find((n) => n.props.testID === testID);
}

function renderSend() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<SendScreen unit="sat" />);
  });
  return renderer;
}

/** Type a whitespace-free destination into the input and re-render. */
function typeDestination(renderer: TestRenderer.ReactTestRenderer, value: string) {
  act(() => {
    byTestID(renderer, 'send-destination-input').props.onChangeText(value);
  });
}

describe('SendScreen — destination entry routes through machine.scan', () => {
  beforeEach(() => {
    mockScan.mockReset();
    mockExecute.mockReset();
    mockStartSendEcash.mockReset();
  });

  it('Paste button reads the clipboard via machine.scan (no data → clipboard source)', () => {
    const renderer = renderSend();
    act(() => {
      byTestID(renderer, 'send-paste').props.onPress();
    });
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockScan).toHaveBeenCalledWith(); // no args ⇒ clipboard read
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('keyboard-submitting a typed destination scans it as paste, not execute', () => {
    const renderer = renderSend();
    typeDestination(renderer, TOKEN);
    act(() => {
      byTestID(renderer, 'send-destination-input').props.onSubmitEditing();
    });
    // `reset: true` so the scan pipeline's processedRef/sendLocked guards can
    // never swallow a deliberate destination submit.
    expect(mockScan).toHaveBeenCalledWith(TOKEN, { source: 'clipboard', reset: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('tapping the detected-action row scans with reset:true (never swallowed by stale guards)', () => {
    const renderer = renderSend();
    typeDestination(renderer, TOKEN);
    act(() => {
      byTestID(renderer, 'detected-row').props.onPress();
    });
    // Regression: the row tap must carry reset:true. Without it, a scan after a
    // dismissed option/mint chooser is dropped by processedRef/sendLocked and
    // "does nothing". reset:true clears both before dispatching.
    expect(mockScan).toHaveBeenCalledWith(TOKEN, { source: 'clipboard', reset: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('hands the FULL multi-option BIP-321 to machine.scan untruncated (opens the chooser)', () => {
    const renderer = renderSend();
    typeDestination(renderer, BIP321_MULTI);
    act(() => {
      byTestID(renderer, 'detected-row').props.onPress();
    });
    expect(mockScan).toHaveBeenCalledWith(BIP321_MULTI, { source: 'clipboard', reset: true });
    // The full string (both lightning= and creq=) must survive so the machine
    // re-parses two options and routes to chooseOption — not a single option.
    const [passed] = mockScan.mock.calls[0] as [string];
    expect(passed).toContain('lightning=');
    expect(passed).toContain('creq=');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('whitespace (a name search) is never handed to the parser', () => {
    const renderer = renderSend();
    typeDestination(renderer, 'calle and friends');
    act(() => {
      byTestID(renderer, 'send-destination-input').props.onSubmitEditing();
    });
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
