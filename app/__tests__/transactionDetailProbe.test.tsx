/**
 * @jest-environment node
 */

import React from 'react';
import { InteractionManager, Dimensions } from 'react-native';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { QRCodeFrame } from '@/shared/ui/composed/QRCodeFrame';
import TestRenderer, { act } from 'react-test-renderer';

import { TransactionDetailShell } from '@/features/transactions/components/detail/TransactionDetailShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockCounterparty: { pubkey: string } | null = null;
const mockScrollTo = jest.fn();
const mockInnerContent = {};
let mockReducedMotion = false;
const mockAfterInteractions: (() => void)[] = [];
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => mockReducedMotion }));
jest.mock('wallet', () => ({ getCounterparty: () => mockCounterparty }));
jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({
  HeaderHeightContext: jest.requireActual<typeof import('react')>('react').createContext(80),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@/shared/ui/composed/AndroidSheetRoot', () => ({
  SheetHeaderHeightContext: jest.requireActual<typeof import('react')>('react').createContext(null),
}));
jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({ FLOW_SHEET_SCRIM_OVERHANG: 0 }));
jest.mock('@/shared/ui/composed/ModalLayoutWrapper', () => ({
  ModalLayoutWrapper: ({
    children,
    bottomContent,
    scrollViewRef,
    scrollContentRef,
    onHeaderHeightChange,
  }: React.PropsWithChildren<{
    bottomContent?: React.ReactNode;
    scrollViewRef: React.Ref<unknown>;
    scrollContentRef: React.RefObject<unknown>;
    onHeaderHeightChange: (height: number) => void;
  }>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    ReactActual.useImperativeHandle(scrollViewRef, () => ({ scrollTo: mockScrollTo }));
    ReactActual.useLayoutEffect(() => {
      scrollContentRef.current = mockInnerContent;
      onHeaderHeightChange(70);
    }, [scrollContentRef, onHeaderHeightChange]);
    return (
      <>
        {children}
        {bottomContent}
      </>
    );
  },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
  paymentLog: { debug: jest.fn(), info: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn() }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({ EnhancedHaptics: { copyHaptic: jest.fn() } }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/GradientCard', () => ({
  GradientCard: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/QRCode', () => ({
  AnimatedQRCode: () => <view data-testid="encoded-qr" />,
  QRSpeedControls: () => null,
  SPEED_PRESETS: [{ label: 'Normal', intervalMs: 1000 }],
  DENSITY_PRESETS: [{ label: 'Normal', fragmentSize: 100 }],
  DEFAULT_SPEED_INDEX: 0,
  DEFAULT_DENSITY_INDEX: 0,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/features/transactions/components/detail/HistoryEntryHeader', () => ({
  HistoryEntryHeader: () => <header />,
}));
jest.mock('@/features/transactions/components/detail/HistoryEntryRefresh', () => ({
  HistoryEntryRefresh: () => null,
}));
jest.mock('@/features/transactions/components/detail/timeline', () => ({
  HistoryEntryTimeline: () => null,
}));
jest.mock('@/features/transactions/components/CounterpartyTransactions', () => ({
  CounterpartyTransactions: () => <view data-testid="related-transactions" />,
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    E2EToastProbe: () => ReactActual.createElement('div', { testID: 'e2e-toast-probe-host' }),
  };
});
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    E2EActionMenuProbe: () =>
      ReactActual.createElement('div', { testID: 'e2e-action-menu-probe-host' }),
  };
});

describe('TransactionDetailShell device probe', () => {
  beforeEach(() => {
    mockCounterparty = null;
    mockAfterInteractions.length = 0;
    Dimensions.set({
      window: { width: 393, height: 852, scale: 3, fontScale: 1 },
      screen: { width: 393, height: 852, scale: 3, fontScale: 1 },
    });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
      if (typeof task === 'function') mockAfterInteractions.push(task);
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'focuses cancellation then keeps the timeline anchored after QR removal (reduced motion: %s)',
    (reducedMotion) => {
      mockReducedMotion = reducedMotion;
      mockScrollTo.mockClear();
      let timelineY = 540;
      const detail = (key?: string, cancelling = false) => (
        <TransactionDetailShell
          screenName="SendTokenScreen"
          testID="scroll-fixture"
          footer={null}
          timeline={<view />}
          timelineFocusKey={key}
          cancelling={cancelling}>
          <view />
        </TransactionDetailShell>
      );
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(detail(), {
          createNodeMock: (element) =>
            (element.props as { testID?: string }).testID === 'transaction-timeline-anchor'
              ? {
                  measureLayout: (relative: unknown, callback: (x: number, y: number) => void) => {
                    expect(relative).toBe(mockInnerContent);
                    callback(0, timelineY);
                  },
                }
              : null,
        });
      });
      expect(mockScrollTo).not.toHaveBeenCalled();
      const layOutTimeline = (): void => {
        renderer.root
          .find(
            (node) => node.type === 'view' && node.props.testID === 'transaction-timeline-anchor'
          )
          .props.onLayout();
      };
      act(() => {
        renderer.update(detail('pending:true', true));
      });
      act(layOutTimeline);
      expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 454, animated: !reducedMotion });
      const calls = mockScrollTo.mock.calls.length;
      act(layOutTimeline);
      expect(mockScrollTo).toHaveBeenCalledTimes(calls);
      timelineY = 179;
      act(() => renderer.update(detail('rolled_back:false')));
      act(layOutTimeline);
      expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 93, animated: false });
      act(() => renderer.unmount());
      mockReducedMotion = false;
    }
  );

  it('commits the known detail and exact blank QR frame before deferred work or payload resolution', () => {
    mockCounterparty = { pubkey: 'fixture-counterparty' };
    const entry = {
      id: 'pending-1',
      type: 'send' as const,
      amount: 50,
      unit: 'sat',
      state: 'pending',
    };
    const detail = (data: string) => (
      <TransactionDetailShell
        screenName="SendTokenScreen"
        testID="known-detail"
        entry={entry as never}
        footer={<view data-testid="detail-footer" />}
        beforeStatus={<PaymentInfo unit="sat" data={data} copyTarget="token" />}>
        <view data-testid="known-details" />
      </TransactionDetailShell>
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(detail(''));
    });
    expect(
      renderer.root.find((node) => node.type === 'view' && node.props.testID === 'known-detail')
    ).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-testid': 'known-details' })).toBeTruthy();
    const frame = renderer.root.findByType(QRCodeFrame);
    expect(frame.props.children.props.style).toEqual({ width: 329, height: 329 });
    expect(renderer.root.findAllByProps({ 'data-testid': 'encoded-qr' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-testid': 'related-transactions' })).toHaveLength(0);
    expect(mockAfterInteractions).toHaveLength(1);
    act(() => {
      mockAfterInteractions[0]();
    });
    expect(renderer.root.findByProps({ 'data-testid': 'related-transactions' })).toBeTruthy();
    act(() => renderer.update(detail('fixture-token')));
    expect(renderer.root.findByProps({ 'data-testid': 'encoded-qr' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'payment-info-qr-placeholder' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('binds the safe JSON value to transaction-probe-${txRef}', async () => {
    const entry = {
      id: 'receive-1',
      type: 'receive' as const,
      amount: 50,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      state: 'finalized',
      token: 'cashuB-never-expose-me',
    };
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <TransactionDetailShell
          screenName="ReceiveTokenScreen"
          testID="receive-token-id-receive-1"
          entry={entry as never}
          source="Paste"
          footer={null}>
          <></>
        </TransactionDetailShell>
      );
    });

    const probe = renderer!.root.find(
      (node) => node.type === 'view' && node.props.testID === 'transaction-probe-receive-1'
    );
    const routeReady = renderer!.root.find(
      (node) => node.type === 'view' && node.props.testID === 'receive-token-id-receive-1'
    );
    expect(renderer!.root.findByProps({ testID: 'e2e-toast-probe-host' })).toBeDefined();
    expect(renderer!.root.findByProps({ testID: 'e2e-action-menu-probe-host' })).toBeDefined();
    expect(routeReady.props.accessible).toBe(true);
    expect(routeReady.props.accessibilityRole).toBe('text');
    expect(routeReady.props.accessibilityLabel).toBe('Transaction detail ready');
    expect(routeReady.props.importantForAccessibility).toBe('yes');
    expect(routeReady.props.collapsable).toBe(false);
    expect(routeReady.props.pointerEvents).toBe('none');
    expect(routeReady.children).toEqual([]);
    expect(JSON.parse(probe.props.accessibilityValue.text)).toEqual({
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
    });
    expect(probe.props.accessibilityValue.text).not.toContain('cashuB');
  });
});
