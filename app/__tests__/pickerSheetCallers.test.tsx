/**
 * @jest-environment node
 *
 * Two pickers that open the picker sheet from inside a component: the
 * underline tabs' "More" overflow, and a signer permission's Allow / Ask /
 * Block. Each asks for the right rows, marks the current one, and acts on
 * the pick.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { PermissionSwitchRow } from '@/features/nostrSigner/components/PermissionKeyRows';
import type { PickerRequest } from '@/shared/lib/picker/types';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPickOption = jest.fn(async (_request: PickerRequest): Promise<string | null> => null);
jest.mock('@/shared/lib/picker/openPicker', () => ({
  pickOption: (request: PickerRequest) => mockPickOption(request),
}));
jest.mock('@/shared/ui/composed/underlineTabsLayout', () => ({
  MORE_BUTTON_WIDTH: 44,
  partitionTabs: (tabs: readonly string[]) => ({
    visible: tabs.slice(0, 1),
    overflow: tabs.slice(1),
  }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? tokens : tokens.map(String),
}));
jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log: { ...entry, child: () => entry },
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  };
});

const element = (name: string) =>
  function MockElement({ children, ...props }: { children?: React.ReactNode }) {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(name, props, children);
  };
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: element('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: element('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: element('View') }));
jest.mock('@/shared/ui/primitives/Switch', () => ({ Switch: element('Switch') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: element('Icon') }));
jest.mock('heroui-native', () => {
  const PressableFeedback = Object.assign(element('PressableFeedback'), {
    Scale: element('PressableFeedback.Scale'),
    Ripple: element('PressableFeedback.Ripple'),
  });
  const ListGroup = Object.assign(element('ListGroup'), {
    Item: element('ListGroup.Item'),
    ItemContent: element('ListGroup.ItemContent'),
    ItemTitle: element('ListGroup.ItemTitle'),
    ItemDescription: element('ListGroup.ItemDescription'),
    ItemSuffix: element('ListGroup.ItemSuffix'),
  });
  return { PressableFeedback, ListGroup };
});

function render(node: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

const lastRequest = () => mockPickOption.mock.calls.at(-1)![0];

beforeEach(() => mockPickOption.mockClear());

describe('UnderlineTabs overflow', () => {
  it('lists the hidden tabs, marks the selected one, and selects the pick', async () => {
    const handleTabPress = jest.fn();
    const tree = render(
      <UnderlineTabs tabs={['A', 'B', 'C']} selectedTab="C" handleTabPress={handleTabPress} />
    );
    const more = tree.root.findByProps({ testID: 'underline-tabs-more' });
    mockPickOption.mockResolvedValueOnce('B');
    await act(async () => {
      more.props.onPress();
    });
    expect(lastRequest().title).toBe('More');
    expect(lastRequest().options!.map(({ testID, selected }) => ({ testID, selected }))).toEqual([
      { testID: 'underline-tab-B-menu', selected: false },
      { testID: 'underline-tab-C-menu', selected: true },
    ]);
    expect(handleTabPress).toHaveBeenCalledWith('B', 1);
  });
});

describe('PermissionSwitchRow', () => {
  it('offers Allow, Ask and Block, Allow disabled with its reason when it needs approval', async () => {
    const onChange = jest.fn();
    const tree = render(
      <PermissionSwitchRow
        label="Sign notes"
        state="ask"
        allowEligible={false}
        onChange={onChange}
        testID="perm"
      />
    );
    mockPickOption.mockResolvedValueOnce('block');
    await act(async () => {
      tree.root.findByType('PressableFeedback' as never).props.onLongPress();
    });
    const options = lastRequest().options!;
    expect(lastRequest().title).toBe('Sign notes');
    expect(options.map((option) => option.testID)).toEqual([
      'signer-permission-allow',
      'signer-permission-ask',
      'signer-permission-block',
    ]);
    expect(options[0]).toMatchObject({ disabled: true, reason: 'Always requires approval' });
    expect(options[1].selected).toBe(true);
    expect(options[2].isCaution).toBe(true);
    expect(onChange).toHaveBeenCalledWith('block');
  });
});
