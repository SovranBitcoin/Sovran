/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import LightningReceiveStandaloneRoute from '@/app/lightningReceive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/features/receive', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    LightningReceiveRoute: (props: Record<string, unknown>) =>
      ReactActual.createElement('lightning-receive-route', props),
  };
});

jest.mock('@/shared/ui/composed/FormSheetChrome', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    FormSheetChrome: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('form-sheet-chrome', props, children),
  };
});

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: Record<string, unknown>) => ReactActual.createElement('view', props),
  };
});

describe('standalone Lightning receive route probe', () => {
  it('exposes a fixed non-secret AX destination only in DEV', () => {
    const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
    const original = runtime.__DEV__;
    runtime.__DEV__ = true;
    let renderer: TestRenderer.ReactTestRenderer;

    try {
      act(() => {
        renderer = TestRenderer.create(<LightningReceiveStandaloneRoute />);
      });

      const probe = renderer!.root.findByProps({
        testID: 'lightning-receive-standalone-ready',
      });
      expect(probe.props).toMatchObject({
        accessible: true,
        accessibilityRole: 'text',
        accessibilityLabel: 'Standalone Lightning receive ready',
        importantForAccessibility: 'yes',
        collapsable: false,
        pointerEvents: 'none',
        style: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 },
      });
      expect(JSON.stringify(probe.props)).not.toMatch(
        /mintHistoryEntry|quote|cashu|bolt11|invoice/i
      );
      const route = renderer!.root.find(
        (node) => (node.type as unknown) === 'lightning-receive-route'
      );
      expect(route.props.where).toBe('app.lightningReceive');

      runtime.__DEV__ = false;
      act(() => {
        renderer!.update(<LightningReceiveStandaloneRoute />);
      });
      expect(
        renderer!.root.findAllByProps({ testID: 'lightning-receive-standalone-ready' })
      ).toEqual([]);
      expect(
        renderer!.root.find((node) => (node.type as unknown) === 'lightning-receive-route')
      ).toBeDefined();
    } finally {
      runtime.__DEV__ = original;
      act(() => renderer?.unmount());
    }
  });
});
