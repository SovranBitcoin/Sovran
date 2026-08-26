/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { ReceiveHubScreen } from '@/features/receive/screens/ReceiveHubScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseScreenActions = jest.fn();

jest.mock('wallet/react', () => ({
  useScreenActions: (...args: unknown[]) => mockUseScreenActions(...args),
}));

jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 0,
}));

jest.mock('@/shared/lib/logger', () => ({
  paymentLog: {
    info: jest.fn(),
    warn: jest.fn(),
  },
  useLifecycleLogger: jest.fn(),
  // persistConfig's onRehydrateStorage error branch calls storeLog.warn; a
  // missing symbol throws inside zustand's rehydrate and fails the suite.
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- test mock needs a real hex
    Array.isArray(tokens) ? tokens.map(() => '#888888') : '#888888',
}));

jest.mock('@/shared/ui/composed/ListRow', () => ({
  ListRow: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('ListRow', props);
  },
}));

jest.mock('@/shared/ui/composed/CircleActionButton', () => ({
  CircleActionButton: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('CircleActionButton', props);
  },
}));

jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('ScreenErrorState', props);
  },
}));

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { testID: `icon-${name}`, ...props });
  },
}));

function action(available = true, reason?: string) {
  return {
    available,
    ...(reason ? { reason } : {}),
    loading: false,
    execute: jest.fn(),
  };
}

function hubActions(overrides?: Record<string, ReturnType<typeof action>>) {
  return {
    back: action(),
    qrDisplay: action(),
    scanQr: action(),
    fixedAmount: action(),
    paste: action(),
    ...overrides,
  };
}

function findByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find((node) => node.props.testID === testID);
}

describe('ReceiveHubScreen', () => {
  beforeEach(() => {
    mockUseScreenActions.mockReset();
  });

  it('renders all four method rows enabled when the entry is loaded', () => {
    const actions = hubActions();
    mockUseScreenActions.mockReturnValue({
      entry: { type: 'receive', id: 'receive-hub', unit: 'sat' },
      error: null,
      actions,
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveHubScreen receiveHubEntry="{}" unit="sat" />);
    });

    for (const id of ['qrDisplay', 'scanQr', 'fixedAmount', 'paste']) {
      const row = findByTestID(renderer!, `receive-method-${id}`);
      expect(row).toBeTruthy();
      expect(row.props.disabled).toBe(false);
    }
  });

  it('executes the matching screen action when a row is pressed', async () => {
    const actions = hubActions();
    mockUseScreenActions.mockReturnValue({
      entry: { type: 'receive', id: 'receive-hub', unit: 'sat' },
      error: null,
      actions,
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveHubScreen receiveHubEntry="{}" unit="sat" />);
    });

    await act(async () => {
      await findByTestID(renderer!, 'receive-method-qrDisplay').props.onPress();
    });
    expect(actions.qrDisplay.execute).toHaveBeenCalled();
    expect(actions.paste.execute).not.toHaveBeenCalled();
  });

  it('disables an unavailable row and surfaces the reason as its subtitle', () => {
    const actions = hubActions({
      fixedAmount: action(false, 'No trusted mint supports Lightning receive'),
    });
    mockUseScreenActions.mockReturnValue({
      entry: { type: 'receive', id: 'receive-hub', unit: 'sat' },
      error: null,
      actions,
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveHubScreen receiveHubEntry="{}" unit="sat" />);
    });

    const row = findByTestID(renderer!, 'receive-method-fixedAmount');
    expect(row.props.disabled).toBe(true);
    expect(row.props.subtitle).toBe('No trusted mint supports Lightning receive');
  });

  it('disables every row until the entry loads', () => {
    mockUseScreenActions.mockReturnValue({
      entry: null,
      error: null,
      actions: hubActions(),
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveHubScreen unit="sat" />);
    });

    for (const id of ['qrDisplay', 'scanQr', 'fixedAmount', 'paste']) {
      expect(findByTestID(renderer!, `receive-method-${id}`).props.disabled).toBe(true);
    }
  });
});
