/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  E2EPaymentToastRenderMarker,
  E2EStaticToastRenderMarker,
  E2EToastProbe,
} from '@/shared/lib/popup/E2EToastProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('DEV static-toast AX probe', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('exposes only the closed popup key after the toast component mounts, then expires it', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <E2EStaticToastRenderMarker probeKey="token-pending-not-redeemed" />
          <E2EToastProbe />
        </>
      );
    });

    const marker = renderer!.root.findByProps({
      testID: 'e2e-toast-token-pending-not-redeemed',
    });
    expect(marker.props.accessibilityLabel).toBe('Static toast visible');
    expect(JSON.stringify(marker.props)).not.toContain('Token is still pending');

    act(() => jest.advanceTimersByTime(5_000));
    expect(
      renderer!.root.findAllByProps({ testID: 'e2e-toast-token-pending-not-redeemed' })
    ).toEqual([]);
  });

  it('retains the confirmed View action past overlay dismissal and clears it after use', () => {
    const onView = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <E2EPaymentToastRenderMarker variant="receive" stage="processing" />
          <E2EToastProbe />
        </>
      );
    });

    expect(renderer!.root.findByProps({ testID: 'payment-status-toast' })).toBeDefined();
    const processing = renderer!.root.findByProps({
      testID: 'payment-status-receive-processing',
    });
    expect(JSON.stringify(processing.props)).not.toContain('quote-1');
    expect(JSON.stringify(processing.props)).not.toContain('33');
    expect(renderer!.root.findAllByProps({ testID: 'payment-status-view' })).toEqual([]);

    act(() => {
      renderer!.update(
        <>
          <E2EPaymentToastRenderMarker variant="receive" stage="confirmed" onView={onView} />
          <E2EToastProbe />
        </>
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'payment-status-receive-processing' })).toEqual(
      []
    );
    expect(
      renderer!.root.findByProps({ testID: 'payment-status-receive-confirmed' })
    ).toBeDefined();
    act(() => renderer!.update(<E2EToastProbe />));
    expect(
      renderer!.root.findByProps({ testID: 'payment-status-receive-confirmed' })
    ).toBeDefined();
    const view = renderer!.root.findByProps({ testID: 'payment-status-view' });
    act(() => {
      void view.props.onPress();
    });
    expect(onView).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByProps({ testID: 'payment-status-toast' })).toEqual([]);

    act(() => renderer!.unmount());
  });

  it('renders no payment seam outside DEV builds', () => {
    const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
    const original = runtime.__DEV__;
    runtime.__DEV__ = false;
    try {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <>
            <E2EPaymentToastRenderMarker variant="receive" stage="confirmed" onView={jest.fn()} />
            <E2EToastProbe />
          </>
        );
      });
      expect(renderer!.toJSON()).toBeNull();
      act(() => renderer!.unmount());
    } finally {
      runtime.__DEV__ = original;
    }
  });
});
