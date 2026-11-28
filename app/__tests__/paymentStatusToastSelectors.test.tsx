/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { PaymentStatusToast } from '@/shared/lib/popup/PaymentStatusToast';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPaymentStatus: { toasts: Record<string, unknown>[] } = { toasts: [] };
const mockOpen = jest.fn(async (..._args: unknown[]) => true);

function show(phase: string, content: Record<string, unknown> = {}): void {
  mockPaymentStatus.toasts = [
    {
      id: 'toast-1',
      key: 'mint:quote-1',
      phase,
      content: {
        kind: 'payment',
        variant: 'receive',
        mintUrl: 'https://mint.sovran.money',
        amount: 33,
        unit: 'sat',
        ...content,
      },
    },
  ];
}

jest.mock('@/shared/hooks/usePaymentCopyResolver', () => {
  const { createPaymentCopyResolver } = jest.requireActual('wallet');
  const resolver = createPaymentCopyResolver();
  return { usePaymentCopyResolver: () => resolver };
});
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
  useSettingsStore: (selector: (state: { displayBtc: number }) => unknown) =>
    selector({ displayBtc: 0 }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { push: jest.fn() } }));
jest.mock('@/shared/hooks/useSingleFlight', () => ({
  useSingleFlight: (callback: (...args: unknown[]) => unknown) => callback,
}));
jest.mock('@/shared/lib/popup/paymentToastTarget', () => ({
  openToastTransaction: (...args: unknown[]) => mockOpen(...args),
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

function render(hide = jest.fn()) {
  const element = () => (
    <>
      <PaymentStatusToast paymentToastId="toast-1" hide={hide} />
      <E2EToastProbe />
    </>
  );
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element());
  });
  const rerender = () => act(() => renderer.update(element()));
  const toast = renderer!.root.find((node) => (node.type as unknown) === 'MockStatusToast');
  return { renderer: renderer!, toast, hide, rerender };
}

describe('PaymentStatusToast selectors', () => {
  beforeEach(() => {
    mockOpen.mockClear();
    mockOpen.mockResolvedValue(true);
  });

  it('names the root and the receive processing stage', () => {
    show('working');
    const { toast } = render();
    expect(toast.props.toastProps.testID).toBe('payment-status-toast');
    expect(toast.props.statusTestID).toBe('payment-status-receive-processing');
  });

  it.each([
    ['handed-off', 'delivered'],
    ['slow', 'warning'],
    ['done', 'confirmed'],
    ['failed', 'failed'],
  ])('names the %s phase as the %s stage', (phase, stage) => {
    show(phase);
    expect(render().toast.props.statusTestID).toBe(`payment-status-receive-${stage}`);
  });

  it('names the receive confirmation stage and View action, which opens the transaction and hides', async () => {
    const target = { type: 'mint', quoteId: 'quote-1' };
    show('done', { target });
    const { renderer, toast, hide } = render();

    expect(toast.props.action.testID).toBe('payment-status-view');
    expect(renderer.root.findByProps({ testID: 'payment-status-receive-confirmed' })).toBeDefined();
    const viewProxy = renderer.root.findByProps({ testID: 'payment-status-view' });
    await act(async () => viewProxy.props.onPress());
    expect(mockOpen).toHaveBeenCalledWith(target, 'https://mint.sovran.money');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('opens the transaction from a tap anywhere on the toast, in any phase', async () => {
    const target = { type: 'mint', quoteId: 'quote-1' };
    show('working', { target });
    const { toast, hide } = render();

    // No pill while it works; the body is the way in.
    expect(toast.props.action).toBeUndefined();
    await act(async () => toast.props.onPress());
    expect(mockOpen).toHaveBeenCalledWith(target, 'https://mint.sovran.money');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('stays up when the transaction could not be opened', async () => {
    mockOpen.mockResolvedValue(false);
    show('done', { target: { type: 'mint', quoteId: 'quote-1' } });
    const { toast, hide } = render();
    await act(async () => toast.props.onPress());
    expect(hide).not.toHaveBeenCalled();
  });

  it('offers nothing to tap while the payment has no id the wallet issued', () => {
    show('done');
    const { toast } = render();
    expect(toast.props.onPress).toBeUndefined();
    expect(toast.props.action).toBeUndefined();
  });

  it('keeps drawing what it last showed once the machine has dropped it (the exit animation)', () => {
    show('done');
    const { renderer, rerender } = render();
    mockPaymentStatus.toasts = [];
    rerender();
    const toast = renderer.root.find((node) => (node.type as unknown) === 'MockStatusToast');
    expect(toast.props.statusTestID).toBe('payment-status-receive-confirmed');
  });
});
