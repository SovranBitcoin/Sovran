/**
 * @jest-environment node
 *
 * The two toast entrypoints (`showToast`, `showCustomToast`) as the toast
 * host sees them: what each hands the registered manager, the shown/hidden
 * logs and callbacks the manager's callbacks fire, and what happens with no
 * manager registered (a warning, nothing shown).
 */
import React from 'react';

import { popupLog } from '@/shared/lib/logger';
import { registerToast, showCustomToast, showToast } from '@/shared/lib/popup/popups/bridge';

jest.mock('@/shared/lib/logger', () => ({
  popupLog: { info: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/shared/lib/popup/CompactToast', () => ({ CompactToast: () => null }));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EStaticToastRenderMarker: () => null }));

type Options = {
  component: (props: Record<string, unknown>) => React.ReactElement;
  duration?: number | 'persistent';
  onShow: () => void;
  onHide: () => void;
};
let shown: Options[] = [];
const info = popupLog.info as jest.Mock;
const warn = popupLog.warn as jest.Mock;
const events = () => info.mock.calls.map(([event, fields]) => [event, fields]);

beforeEach(() => {
  shown = [];
  info.mockReset();
  warn.mockReset();
});

describe('with no toast host registered', () => {
  it('warns and shows nothing, for either entrypoint', () => {
    const onShow = jest.fn();
    showToast({ variant: 'success', label: 'Sent', onShow });
    showCustomToast({
      component: function Custom() {
        return <></>;
      },
      onShow,
    });

    expect(warn.mock.calls).toEqual([
      [
        'popup.toast.manager_not_registered',
        { toastId: expect.stringMatching(/^toast-/), label: 'Sent', caller: expect.anything() },
      ],
      [
        'popup.toast.manager_not_registered',
        {
          toastId: expect.stringMatching(/^toast-/),
          componentName: 'Custom',
          caller: expect.anything(),
        },
      ],
    ]);
    expect(onShow).not.toHaveBeenCalled();
  });
});

describe('with a toast host', () => {
  beforeAll(() => {
    registerToast({
      show: (options) => {
        shown.push(options as unknown as Options);
        return `manager-${shown.length}`;
      },
      hide: jest.fn(),
    });
  });

  it('showToast hands over a standard toast and logs show, shown and hidden with its ids', () => {
    const order: string[] = [];
    showToast({
      variant: 'warning',
      label: 'Low balance',
      description: 'Top up',
      durationMs: 3000,
      debugLabel: 'low',
      debugFields: { extra: 1 },
      onShow: () => order.push('onShow'),
      onHide: () => order.push('onHide'),
    });

    expect(shown).toHaveLength(1);
    expect(shown[0]).toEqual({
      component: expect.any(Function),
      duration: 3000,
      onShow: expect.any(Function),
      onHide: expect.any(Function),
    });
    const toastId = events()[0]![1].toastId as string;
    expect(toastId).toMatch(/^toast-/);

    shown[0]!.onShow();
    shown[0]!.onHide();

    expect(order).toEqual(['onShow', 'onHide']);
    expect(events().map(([event]) => event)).toEqual([
      'popup.toast.show',
      'popup.toast.shown',
      'popup.toast.hidden',
    ]);
    const lifecycle = { toastId, managerToastId: 'manager-1', label: 'Low balance' };
    expect(events()[1]![1]).toEqual({
      ...lifecycle,
      variant: 'warning',
      debugLabel: 'low',
      extra: 1,
    });
    expect(Object.keys(events()[1]![1])).toEqual([
      'toastId',
      'managerToastId',
      'label',
      'variant',
      'debugLabel',
      'extra',
    ]);
    expect(events()[2]![1]).toEqual(events()[1]![1]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('showCustomToast renders the caller’s component with the toast id and debug fields', () => {
    const rendered: Record<string, unknown>[] = [];
    function PaymentToast(props: Record<string, unknown>) {
      rendered.push(props);
      return <></>;
    }
    const onShow = jest.fn();
    showCustomToast({
      component: PaymentToast,
      durationMs: 'persistent',
      debugLabel: 'pay',
      debugFields: { amount: 'redacted' },
      onShow,
    });

    const options = shown.at(-1)!;
    expect(options.duration).toBe('persistent');
    const toastId = events()[0]![1].toastId as string;
    options.component({ hide: 'h' });
    expect(rendered).toEqual([
      { hide: 'h', toastId, debugLabel: 'pay', toastDebugFields: { amount: 'redacted' } },
    ]);

    options.onShow();
    options.onHide();
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(events().map(([event, fields]) => [event, Object.keys(fields)])).toEqual([
      [
        'popup.toast.custom_show',
        ['toastId', 'componentName', 'debugLabel', 'durationMs', 'caller', 'amount'],
      ],
      [
        'popup.toast.custom_shown',
        ['toastId', 'managerToastId', 'componentName', 'debugLabel', 'amount'],
      ],
      [
        'popup.toast.custom_hidden',
        ['toastId', 'managerToastId', 'componentName', 'debugLabel', 'amount'],
      ],
    ]);
    expect(events()[1]![1]).toMatchObject({
      toastId,
      managerToastId: `manager-${shown.length}`,
      componentName: 'PaymentToast',
    });
  });
});
