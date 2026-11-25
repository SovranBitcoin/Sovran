/**
 * @jest-environment node
 *
 * A Settings toggle row is one control, so VoiceOver and TalkBack read only
 * its label: the status beside the title and the line under it must be in
 * that label, or a screen-reader user never hears "Offline" or why the row is
 * dimmed.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SettingsToggleItem } from '@/shared/ui/composed/SettingsRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(name, props, props.children as React.ReactNode);
}

// The row's pressable surface, as a host element whose props the test reads.
jest.mock('@/shared/ui/primitives/PressableFeedback', () => ({
  PressableFeedback: Object.assign(mockHost('Row'), {
    Scale: mockHost('Scale'),
    Ripple: () => null,
    Highlight: () => null,
  }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'c' }));
jest.mock('@/shared/ui/primitives/Switch', () => ({ Switch: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('RNView') }));

function labelOf(element: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(element);
  });
  const label = r.root.findByType('Row' as never).props.accessibilityLabel;
  act(() => r.unmount());
  return label;
}

const base = { isSelected: true, onSelectedChange: () => {} };

it('reads the title, the status and the description', () => {
  expect(
    labelOf(
      <SettingsToggleItem
        {...base}
        title="Fast cache"
        statusLabel="Offline"
        description="A public cache that loads profiles quickly"
      />
    )
  ).toBe('Fast cache, Offline, A public cache that loads profiles quickly');
});

it('reads a custom label in place of the title, keeping status and description', () => {
  expect(
    labelOf(
      <SettingsToggleItem
        {...base}
        title="Fast cache"
        accessibilityLabel="Use Fast cache"
        statusLabel="Online"
        description="Public caches, tried in order"
      />
    )
  ).toBe('Use Fast cache, Online, Public caches, tried in order');
});

it('reads why a disabled row is dimmed', () => {
  expect(
    labelOf(
      <SettingsToggleItem
        {...base}
        title="cache.example"
        accessibilityLabel="Use cache.example"
        description="ignored while disabled"
        disabled
        disabledReason="Turn on Fast cache to use this"
      />
    )
  ).toBe('Use cache.example, Turn on Fast cache to use this');
});
