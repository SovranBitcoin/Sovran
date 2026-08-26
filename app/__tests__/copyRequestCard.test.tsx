/**
 * @jest-environment node
 *
 * CopyRequestCard/CopyRequestRow — the copyable payment-request row shared by
 * the receive rails (reusable-quote tab, unified BIP-321 tab, npc address
 * card, creq customization card) and ShareScreen. Pins the chrome the five
 * call sites consolidated onto: rail icon, truncated display, copy glyph,
 * and the caller-owned press handler.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { CopyRequestCard, CopyRequestRow } from '@/shared/ui/composed/CopyRequestCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { testID: `icon-${name}`, ...props });
  },
}));

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  const ListGroup = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup', props, children);
  ListGroup.Item = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.Item', props, children);
  ListGroup.ItemPrefix = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemPrefix', props, children);
  ListGroup.ItemContent = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemContent', props, children);
  ListGroup.ItemTitle = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemTitle', props, children);
  ListGroup.ItemSuffix = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('ListGroup.ItemSuffix', props, children);

  const PressableFeedback = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('PressableFeedback', props, children);
  PressableFeedback.Scale = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('PressableFeedback.Scale', props, children);
  PressableFeedback.Ripple = (props: Record<string, unknown>) =>
    ReactActual.createElement('PressableFeedback.Ripple', props);

  return { ListGroup, PressableFeedback };
});

jest.mock('@/shared/ui/composed/GradientCard', () => ({
  GradientCard: ({ children }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('GradientCard', null, children);
  },
}));

jest.mock('@/shared/ui/composed/Section', () => ({
  Section: ({ title, children }: { title?: string; children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Section', { title }, children);
  },
}));

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function findByType(renderer: TestRenderer.ReactTestRenderer, type: string) {
  return renderer.root.find((node) => node.type === type);
}

function findAllByType(renderer: TestRenderer.ReactTestRenderer, type: string) {
  return renderer.root.findAll((node) => node.type === type);
}

describe('CopyRequestRow', () => {
  it('renders the rail icon, truncated display, and copy glyph on a pressable row', () => {
    const onPress = jest.fn();
    const renderer = render(
      <CopyRequestRow icon="ph:coins" display="creqA…xyz" muted="muted-color" onPress={onPress} />
    );

    expect(renderer.root.findByProps({ testID: 'icon-ph:coins' }).props.color).toBe('muted-color');
    expect(renderer.root.findByProps({ testID: 'icon-lets-icons:copy' }).props.color).toBe(
      'muted-color'
    );
    expect(findByType(renderer, 'ListGroup.ItemTitle').props.children).toBe('creqA…xyz');

    const pressable = findByType(renderer, 'PressableFeedback');
    expect(pressable.props.animation).toBe(false);
    pressable.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('forwards testID and accessibilityLabel to the pressable', () => {
    const renderer = render(
      <CopyRequestRow
        icon="stash:qr-code"
        display="bitcoin:…"
        muted="muted-color"
        onPress={jest.fn()}
        testID="receive-copy-row"
        accessibilityLabel="Copy request"
      />
    );
    const pressable = findByType(renderer, 'PressableFeedback');
    expect(pressable.props.testID).toBe('receive-copy-row');
    expect(pressable.props.accessibilityLabel).toBe('Copy request');
  });
});

describe('CopyRequestCard', () => {
  it('wraps the row in the titled Section/GradientCard chrome', () => {
    const renderer = render(
      <CopyRequestCard
        title="RECEIVE ADDRESS"
        icon="mingcute:lightning-fill"
        display="npubca…ample"
        muted="muted-color"
        onPress={jest.fn()}
      />
    );

    expect(findByType(renderer, 'Section').props.title).toBe('RECEIVE ADDRESS');
    expect(findAllByType(renderer, 'GradientCard')).toHaveLength(1);
    expect(findByType(renderer, 'ListGroup').props.variant).toBe('transparent');
    expect(findByType(renderer, 'ListGroup.ItemTitle').props.children).toBe('npubca…ample');
  });
});
