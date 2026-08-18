/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { PaymentStatusToast } from '@/shared/lib/popup/PaymentStatusToast';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPaymentStatus: { active: Record<string, unknown> | null } = {
  active: { id: 'quote-1', state: 'processing' },
};

jest.mock('wallet', () => ({
  createPaymentCopyGroups: jest.fn(() => ({
    TOAST_COPY: {
      receive: {
        message: 'Receiving',
        processing: 'Processing',
        confirmed: 'Received',
        failed: 'Failed',
      },
      send: {
        message: 'Sending',
        processing: 'Processing',
        confirmed: 'Sent',
        failed: 'Failed',
      },
      melt: {
        message: 'Sending',
        processing: 'Processing',
        confirmed: 'Sent',
        failed: 'Failed',
      },
      'receive-ecash': {
        message: 'Receiving',
        processing: 'Processing',
        confirmed: 'Received',
        failed: 'Failed',
      },
      'payment-request': {
        message: 'Sending request',
        processing: 'Processing',
        delivered: 'Delivered',
        confirmed: 'Confirmed',
        failed: 'Failed',
      },
    },
  })),
}));
jest.mock('@/shared/hooks/usePaymentCopyResolver', () => ({
  usePaymentCopyResolver: jest.fn(() => jest.fn()),
}));
jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: Record<string, unknown>) => ReactActual.createElement('div', props),
  };
});
jest.mock('@/shared/ui/primitives/Pressable', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Pressable: (props: Record<string, unknown>) => ReactActual.createElement('button', props),
  };
});
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: (selector: (state: typeof mockPaymentStatus) => unknown) =>
    selector(mockPaymentStatus),
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: (selector: (state: { radarVisible: boolean }) => unknown) =>
    selector({ radarVisible: false }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { getDisplayBtc: () => number }) => unknown) =>
    selector({ getDisplayBtc: () => 0 }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    isInitialized: jest.fn(() => true),
    getInstance: jest.fn(() => ({
      history: { getPaginatedHistory: jest.fn(async () => []) },
    })),
  },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/hooks/useSingleFlight', () => ({
  useSingleFlight: (callback: (...args: unknown[]) => unknown) => callback,
}));
jest.mock('@/shared/lib/cashu/syntheticHistory', () => ({ asHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  getMeltDetailPathname: jest.fn(),
  getMintDetailPathname: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  popupLog: { info: jest.fn(), warn: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/popup/useToastSurface', () => ({
  useToastSurface: jest.fn(() => ({ fg: 'white', bg: 'black' })),
}));
jest.mock('@/shared/lib/popup/StatusToast', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    StatusToast: (props: Record<string, unknown>) =>
      ReactActual.createElement('MockStatusToast', props),
  };
});

describe('PaymentStatusToast selectors', () => {
  beforeEach(() => {
    mockPaymentStatus.active = { id: 'quote-1', state: 'processing' };
  });

  it('names the root and receive processing stage', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PaymentStatusToast
          variant="receive"
          paymentId="quote-1"
          mintUrl="https://mint.sovran.money"
          amount={33}
          unit="sat"
          hide={jest.fn()}
        />
      );
    });

    const toast = renderer!.root.find((node) => (node.type as unknown) === 'MockStatusToast');
    expect(toast.props.toastProps.testID).toBe('payment-status-toast');
    expect(toast.props.statusTestID).toBe('payment-status-receive-processing');
  });

  it('names the receive confirmation stage and View action', async () => {
    mockPaymentStatus.active = { id: 'quote-1', state: 'confirmed' };
    const hide = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <>
          <PaymentStatusToast
            variant="receive"
            paymentId="quote-1"
            mintUrl="https://mint.sovran.money"
            amount={33}
            unit="sat"
            hide={hide}
          />
          <E2EToastProbe />
        </>
      );
    });

    const toast = renderer!.root.find((node) => (node.type as unknown) === 'MockStatusToast');
    expect(toast.props.statusTestID).toBe('payment-status-receive-confirmed');
    expect(toast.props.action.testID).toBe('payment-status-view');
    expect(
      renderer!.root.findByProps({ testID: 'payment-status-receive-confirmed' })
    ).toBeDefined();
    const viewProxy = renderer!.root.findByProps({ testID: 'payment-status-view' });
    await act(async () => viewProxy.props.onPress());
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
