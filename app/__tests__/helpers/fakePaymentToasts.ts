/**
 * A stand-in for `@/shared/stores/runtime/paymentStatusStore` in tests of code
 * that only reports to the payment toasts: it records what was reported per
 * key, with none of the machine's timing.
 *
 *   jest.mock('@/shared/stores/runtime/paymentStatusStore', () =>
 *     require('./helpers/fakePaymentToasts').fakePaymentStatusStore);
 */

type Toast = { key: string; phase: string; content: Record<string, unknown> };

const toasts = new Map<string, Toast>();

/** Every `report(key, phase, content)` call, in order. */
export const toastReports: Toast[] = [];

export function resetFakePaymentToasts(): void {
  toasts.clear();
  toastReports.length = 0;
}

export const fakePaymentStatusStore = {
  toastKey: {
    receive: (id: string) => `receive:${id}`,
    melt: (id: string) => `melt:${id}`,
    mint: (id: string) => `mint:${id}`,
    send: (id: string) => `send:${id}`,
    swap: (id: string) => `swap:${id}`,
    pending: (id: string) => `pending:${id}`,
  },
  paymentToasts: {
    start: (key: string, content: Record<string, unknown>) =>
      void toasts.set(key, { key, phase: 'working', content }),
    report: (key: string, phase: string, content: Record<string, unknown>) => {
      toastReports.push({ key, phase, content });
      toasts.set(key, { key, phase, content });
    },
    get: (key: string) => toasts.get(key),
    dismiss: (key: string) => void toasts.delete(key),
    dismissAll: () => toasts.clear(),
  },
};
