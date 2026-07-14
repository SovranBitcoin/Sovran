/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { registerToast, showToast } from '@/shared/lib/popup/popups/bridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/logger', () => ({
  popupLog: { info: jest.fn(), warn: jest.fn() },
}));

jest.mock('@/shared/lib/popup/CompactToast', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    CompactToast: () => ReactActual.createElement('MockCompactToast'),
  };
});

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: Record<string, unknown>) => ReactActual.createElement('div', props),
  };
});

describe('HeroUI static-toast render probe bridge', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not expose the probe until HeroUI renders the toast component', () => {
    let toastOptions: Record<string, unknown> | undefined;
    registerToast({
      show: (options) => {
        toastOptions = options as Record<string, unknown>;
        return 'manager-toast-id';
      },
      hide: jest.fn(),
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<E2EToastProbe />);
      showToast({
        variant: 'warning',
        label: 'Not copied into the probe',
        e2eProbeKey: 'token-pending-not-redeemed',
      });
    });

    expect(
      renderer!.root.findAllByProps({ testID: 'e2e-toast-token-pending-not-redeemed' })
    ).toEqual([]);

    const renderToast = toastOptions?.component as (
      props: Record<string, unknown>
    ) => React.ReactElement;
    expect(renderToast).toEqual(expect.any(Function));

    act(() => {
      renderer!.update(
        <>
          {renderToast({ hide: jest.fn() })}
          <E2EToastProbe />
        </>
      );
    });

    const marker = renderer!.root.findByProps({
      testID: 'e2e-toast-token-pending-not-redeemed',
    });
    expect(marker.props.accessibilityLabel).toBe('Static toast visible');
    expect(JSON.stringify(marker.props)).not.toContain('Not copied into the probe');
  });
});
