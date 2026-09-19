/**
 * @jest-environment node
 *
 * CopyRequestCard/CopyRequestRow — the copyable payment-request row shared by
 * the receive rails (reusable-quote tab, unified BIP-321 tab, npc address
 * card, creq customization card) and ShareScreen. Pins the chrome the five
 * call sites consolidated onto: rail icon, the value in monospace for
 * verification, copy glyph, and the caller-owned press handler.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
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

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () =>
    jest.requireActual<typeof import('@/shared/lib/brandColors')>('@/shared/lib/brandColors')
      .INVARIANT_WHITE,
}));

jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/Skeleton', () => ({
  Skeleton: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Skeleton', props);
  },
}));

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

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

function values(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => String(node.type) === 'Text' && node.props.testID === 'copy-request-value')
    .map((node) => node.props.children as string);
}

describe('CopyRequestRow', () => {
  it('renders the rail icon, one line of monospace code, and a copy glyph on a pressable row', () => {
    const onPress = jest.fn();
    const renderer = render(
      <CopyRequestRow
        icon="hugeicons:blockchain-01"
        parts={[{ value: ADDRESS }]}
        muted="muted-color"
        onPress={onPress}
      />
    );

    expect(renderer.root.findByProps({ testID: 'icon-hugeicons:blockchain-01' }).props.color).toBe(
      'muted-color'
    );
    // The copy glyph is primary colour, so the action reads clearly.
    expect(renderer.root.findByProps({ testID: 'icon-lets-icons:copy' }).props.color).toBe(
      INVARIANT_WHITE
    );
    // One line of code: both ends of the address, grouped for reading.
    expect(values(renderer)).toEqual(['bc1q w508 ···· 7kyg t080']);
    expect(
      renderer.root.find(
        (node) => String(node.type) === 'Text' && node.props.testID === 'copy-request-value'
      ).props.family
    ).toBe('mono');
    expect(findByType(renderer, 'ListGroup.ItemContent').props.className).toContain('min-w-0');
    expect(findByType(renderer, 'ListGroup.ItemPrefix').props.className).toContain('shrink-0');
    expect(findByType(renderer, 'ListGroup.ItemSuffix').props.className).toContain('shrink-0');

    const pressable = findByType(renderer, 'PressableFeedback');
    expect(pressable.props.animation).toBe(false);
    pressable.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('names a part in the primary colour above its smaller, off-primary code', () => {
    const renderer = render(
      <CopyRequestRow
        icon="ph:coins"
        parts={[{ label: 'Cashu', value: `creqB${'x'.repeat(200)}` }]}
        muted="m"
        onPress={jest.fn()}
      />
    );
    const label = findAllByType(renderer, 'Text').find((node) => node.props.children === 'Cashu')!;
    const code = renderer.root.find(
      (node) => String(node.type) === 'Text' && node.props.testID === 'copy-request-value'
    );
    expect(label.props.size).toBeGreaterThan(code.props.size);
    expect(code.props.color).not.toBe(label.props.color);
    expect(values(renderer)[0]).toContain(' ···· ');
  });

  it('holds the code line at one fixed height whether loading or loaded, so nothing shifts', () => {
    const row = (loading: boolean) =>
      render(
        <CopyRequestRow
          icon="ph:coins"
          parts={[{ label: 'Cashu', value: loading ? '' : `creqB${'x'.repeat(200)}` }]}
          muted="m"
          loading={loading}
        />
      );
    const slotOf = (renderer: TestRenderer.ReactTestRenderer) =>
      renderer.root.find(
        (node) =>
          typeof node.props.className === 'string' && node.props.className.includes('h-[18px]')
      );
    const loaded = row(false);
    expect(slotOf(loaded).findByProps({ testID: 'copy-request-value' }).props.numberOfLines).toBe(
      1
    );
    const loadingRow = row(true);
    expect(slotOf(loadingRow).findAll((node) => String(node.type) === 'Skeleton')).toHaveLength(1);
  });

  it('shows plain words instead of code when a part has no value to verify', () => {
    const renderer = render(
      <CopyRequestRow
        icon="stash:qr-code"
        parts={[{ label: 'Unified link', description: "The payer's wallet picks a method" }]}
        muted="m"
        onPress={jest.fn()}
      />
    );
    expect(findAllByType(renderer, 'Text').map((node) => node.props.children)).toContain(
      "The payer's wallet picks a method"
    );
    expect(values(renderer)).toEqual([]);
  });

  it('keeps the part name while the value is still loading', () => {
    const renderer = render(
      <CopyRequestRow icon="ph:coins" parts={[{ label: 'Cashu', value: '' }]} muted="m" loading />
    );
    expect(findAllByType(renderer, 'Text').map((node) => node.props.children)).toContain('Cashu');
    expect(findAllByType(renderer, 'Skeleton').length).toBeGreaterThan(0);
    expect(values(renderer)).toEqual([]);
  });

  it('forwards testID and accessibilityLabel to the pressable', () => {
    const renderer = render(
      <CopyRequestRow
        icon="stash:qr-code"
        parts={[{ value: 'user@example.com', kind: 'lightningAddress' }]}
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
        parts={[{ value: 'npubcash@example.com', kind: 'lightningAddress' }]}
        muted="muted-color"
        onPress={jest.fn()}
      />
    );

    expect(findByType(renderer, 'Section').props.title).toBe('RECEIVE ADDRESS');
    expect(findAllByType(renderer, 'GradientCard')).toHaveLength(1);
    expect(findByType(renderer, 'ListGroup').props.variant).toBe('transparent');
    expect(values(renderer)).toEqual(['npubcash@example.com']);
  });

  it('shows skeleton lines in place of the value while loading', () => {
    const renderer = render(
      <CopyRequestCard title="RECEIVE ADDRESS" icon="stash:qr-code" parts={[]} muted="m" loading />
    );
    expect(findAllByType(renderer, 'Skeleton').length).toBeGreaterThan(0);
    expect(values(renderer)).toEqual([]);
  });
});
