/**
 * @jest-environment node
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ReceiveScreen } from '@/features/receive/screens/ReceiveScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseScreenActions = jest.fn();

jest.mock('wallet/react', () => ({
  useScreenActions: (...args: unknown[]) => mockUseScreenActions(...args),
  // The screen-owned standing creq (fresh-per-visit): loading until the
  // fresh request lands — mirrors the no-stale-seed hook behavior.
  useStandingPaymentRequest: () => ({
    request: null,
    isLoading: true,
    error: null,
    rotate: jest.fn(),
  }),
}));

jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (
    selector: (state: {
      creqP2pkLock: boolean;
      creqExcludedMints: Record<string, boolean>;
    }) => unknown
  ) => selector({ creqP2pkLock: false, creqExcludedMints: {} }),
}));

// ReceiveScreen derives the advertised-mint selection from coco's trusted
// mints; the node test environment has no CocoCashuProvider.
jest.mock('@cashu/coco-react', () => ({
  useMints: () => ({ trustedMints: [] }),
}));

jest.mock('@/features/receive/lib/standingQuoteIdentityStore', () => ({
  MAX_ADVERTISED_MINTS: 5,
  standingQuoteIdentityStore: {
    get: jest.fn(),
    set: jest.fn(),
    subscribe: () => () => {},
  },
}));

jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => ({
    trustedMintUrls: [],
    mintBalances: {},
    mintMethodCapabilities: {},
    proofAmounts: {},
  }),
}));

// The popup barrel pulls AmountFormatter → uniwind, which the node test
// environment can't load; ReceiveScreen only needs copyPopup from it.
jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

jest.mock('@/features/receive/components/ReceiveReusableQuoteTab', () => ({
  ReceiveReusableQuoteTab: () => null,
}));
jest.mock('@/features/receive/components/ReceivePaymentRequestTab', () => ({
  ReceivePaymentRequestTab: () => null,
}));
jest.mock('@/features/receive/components/ReceiveUnifiedTab', () => ({
  ReceiveUnifiedTab: () => null,
}));

jest.mock('@/shared/lib/logger', () => ({
  // fadeRevealProbe (pulled in via SkeletonContentCrossfade) logs an armed
  // marker at module load through the default `log`.
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  paymentLog: {
    info: jest.fn(),
    warn: jest.fn(),
  },
  // The loading placeholder's SkeletonLoadingShimmer routes through
  // contentShiftLog, which reads feedLog.isLevelEnabled. Disabled → no logging.
  feedLog: {
    isLevelEnabled: () => false,
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  useLifecycleLogger: jest.fn(),
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  // Hex values: the loading placeholder now renders a SkeletonLoadingShimmer
  // whose gradient runs colors through hex-color-opacity, which rejects names.
  useThemeColor: (tokens: string | string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- test mock needs a real hex
    Array.isArray(tokens) ? tokens.map(() => '#888888') : '#888888',
}));

jest.mock('@/shared/hooks/useMintInfo', () => ({
  useMintInfo: () => null,
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { quickAccessP2PK: boolean }) => unknown) =>
    selector({ quickAccessP2PK: false }),
}));

jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: (selector: (state: { isUpdating: boolean }) => unknown) =>
    selector({ isUpdating: false }),
}));

jest.mock('@/shared/lib/strings', () => ({
  truncateMiddle: (value: string) => value,
}));

jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({
    children,
    footer,
    ...props
  }: {
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Screen', props, footer, children);
  },
  useScreenOptions: jest.fn(),
}));

jest.mock('@/shared/ui/composed/PillTabs', () => ({
  PILL_TABS_HEIGHT: 56,
  PillTabs: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('PillTabs', props);
  },
}));

jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('ScreenErrorState', props);
  },
}));

jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('BottomButtons', null, children);
  },
}));

jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: ({ buttons }: { buttons: { testID?: string; condition?: boolean }[] }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(
      'ButtonHandler',
      null,
      buttons
        .filter((button) => button.condition !== false)
        .map((button) => ReactActual.createElement('Button', { key: button.testID, ...button }))
    );
  },
}));

jest.mock('@/shared/blocks/PaymentInfo', () => ({
  PaymentInfo: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('PaymentInfo', props);
  },
}));

jest.mock('@/features/transactions', () => ({
  HistoryEntryRefresh: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('HistoryEntryRefresh', props);
  },
}));

jest.mock('@/shared/ui/composed/Section', () => ({
  Section: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Section', props, children);
  },
}));

jest.mock('@/shared/ui/composed/GradientCard', () => ({
  GradientCard: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('GradientCard', props, children);
  },
}));

jest.mock('@/shared/ui/composed/UnderlineTabs', () => ({
  UnderlineTabs: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('UnderlineTabs', props);
  },
}));

jest.mock('@/shared/ui/primitives/Skeleton', () => ({
  Skeleton: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Skeleton', props);
  },
}));

jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: {
    copyHaptic: jest.fn(),
  },
}));

jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('View', props, children);
  },
}));

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { testID: `icon-${name}`, ...props });
  },
}));

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  const ListGroup = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup', props, children);
  ListGroup.Item = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.Item', props, children);
  ListGroup.ItemPrefix = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemPrefix', props, children);
  ListGroup.ItemContent = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemContent', props, children);
  ListGroup.ItemTitle = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemTitle', props, children);
  ListGroup.ItemSuffix = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemSuffix', props, children);

  const PressableFeedback = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('PressableFeedback', props, children);
  PressableFeedback.Scale = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('PressableFeedback.Scale', props, children);
  PressableFeedback.Ripple = (props: Record<string, unknown>) =>
    ReactActual.createElement('PressableFeedback.Ripple', props);

  return { ListGroup, PressableFeedback };
});

function action(available = true) {
  return {
    available,
    loading: false,
    execute: jest.fn(),
  };
}

function receiveActions() {
  return {
    back: action(),
    changeNpcMint: action(),
    changeBolt12Mint: action(),
    changeOnchainMint: action(),
    copy: action(),
    share: action(),
  };
}

function findAllByType(renderer: TestRenderer.ReactTestRenderer, type: string) {
  return renderer.root.findAll((node) => node.type === type);
}

function findByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find((node) => node.props.testID === testID);
}

describe('ReceiveScreen layout stability', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockUseScreenActions.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the QR display shell and footer Copy on the first valid entry render', () => {
    const npcAddress = {
      toString: () => 'npubcash1example',
      truncate: () => 'npubca...ample',
    };
    mockUseScreenActions.mockReturnValue({
      entry: {
        type: 'receive',
        id: 'receive-hub',
        npcAddress,
        selectedMintUrl: 'https://mint.example',
      },
      error: null,
      actions: receiveActions(),
      mintUrl: 'https://mint.example',
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ReceiveScreen receiveEntry={JSON.stringify({ type: 'receive' })} unit="sat" />
      );
    });

    const screen = findAllByType(renderer!, 'Screen')[0];
    expect(screen.props.name).toBe('ReceiveScreen');
    expect(screen.props.contentPadding).toBe(0);
    expect(screen.props.deferContent).toBe(false);

    expect(findAllByType(renderer!, 'ScreenErrorState')).toHaveLength(0);
    expect(findAllByType(renderer!, 'PaymentInfo')).toHaveLength(1);
    // Paste / Fixed Amount / Scan QR moved to the receive hub — the QR
    // display's footer is a single Copy of the visible tab's payload.
    const copyButton = findByTestID(renderer!, 'receive-copy');
    expect(copyButton).toBeTruthy();
    // Default tab is Unified and its (mocked) rail reported no payload yet,
    // so Copy renders disabled until a payload lands.
    expect(copyButton.props.disabled).toBe(true);

    act(() => {
      renderer!.unmount();
    });
  });

  it('keeps an in-place QR-sized placeholder instead of swapping to a loading screen', () => {
    mockUseScreenActions.mockReturnValue({
      entry: null,
      error: null,
      actions: receiveActions(),
      mintUrl: undefined,
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ReceiveScreen receiveEntry={JSON.stringify({ type: 'receive' })} unit="sat" />
      );
    });

    expect(findAllByType(renderer!, 'Screen')).toHaveLength(1);
    expect(findAllByType(renderer!, 'ScreenErrorState')).toHaveLength(0);
    expect(findByTestID(renderer!, 'receive-hub-placeholder')).toBeTruthy();
    expect(
      StyleSheet.flatten(findByTestID(renderer!, 'receive-hub-qr-placeholder').props.style)
    ).toEqual(
      expect.objectContaining({
        borderRadius: 16,
      })
    );
    expect(findByTestID(renderer!, 'receive-copy').props.disabled).toBe(true);

    act(() => {
      renderer!.unmount();
    });
  });
});
