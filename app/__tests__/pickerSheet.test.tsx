/**
 * @jest-environment node
 *
 * The picker sheet's page: tabs filter the rows, the current choice is drawn
 * with its check and announced, a disabled row says why, and a tap answers.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { PickerRequest } from '@/shared/lib/picker/types';
import { usePickerSheetStore } from '@/shared/stores/runtime/pickerSheetStore';
import { PickerSheetScreen } from '@/shared/ui/composed/PickerSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPick = jest.fn();
jest.mock('@/shared/lib/picker/useSheetRouteScreen', () => ({
  useSheetRouteScreen: () => mockPick,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? tokens : tokens.map(String),
}));

const element = (name: string) =>
  function MockElement({ children, ...props }: { children?: React.ReactNode }) {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(name, props, children);
  };

jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({
    children,
    stickyContent,
    footer,
  }: {
    children?: React.ReactNode;
    stickyContent?: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Screen', null, stickyContent, children, footer);
  },
  useScreenOptions: jest.fn(),
}));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({
  ScreenScrollView: element('ScreenScrollView'),
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: element('ScreenHeaderAction'),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: element('BottomButtons'),
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: element('ButtonHandler'),
}));
jest.mock('@/shared/ui/composed/ListRow', () => ({ ListRow: element('ListRow') }));
jest.mock('@/shared/ui/composed/PillTabs', () => ({
  PILL_TABS_HEIGHT: 56,
  PillTabs: element('PillTabs'),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: element('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: element('View') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: element('Icon') }));

const REQUEST: PickerRequest = {
  title: 'Pick',
  testID: 'pick-list',
  sections: [
    { id: 'empty', title: 'Empty', options: [] },
    {
      id: 'one',
      title: 'One',
      testID: 'tab-one',
      options: [{ id: 'a', title: 'A', testID: 'row-a' }],
    },
    {
      id: 'two',
      title: 'Two',
      options: [
        { id: 'b', title: 'B', testID: 'row-b', selected: true, description: 'About B' },
        {
          id: 'c',
          title: 'C',
          testID: 'row-c',
          disabled: true,
          reason: 'Not now',
          description: 'x',
        },
      ],
    },
  ],
  actions: [{ id: 'new', title: 'New', testID: 'pick-new' }],
};

function render(request: PickerRequest) {
  act(() => {
    usePickerSheetStore.getState().show(request);
  });
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PickerSheetScreen />);
  });
  return tree;
}

const rows = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType('ListRow' as never).map((row) => row.props.testID as string);
const row = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.findAllByType('ListRow' as never).find((node) => node.props.testID === testID)!;

beforeEach(() => mockPick.mockClear());
afterEach(() => {
  act(() => {
    usePickerSheetStore.getState().clear();
  });
});

describe('PickerSheetScreen', () => {
  it('leaves out tabs with no rows and opens on the one holding the choice', () => {
    const tree = render(REQUEST);
    const tabs = tree.root.findByType('PillTabs' as never).props;
    expect(tabs.tabs).toEqual(['one', 'two']);
    expect(tabs.activeTab).toBe('two');
    expect(tabs.testIDFor('one')).toBe('tab-one');
    expect(tabs.testIDFor('two')).toBe('picker-tab-two');
    expect(rows(tree)).toEqual(['row-b', 'row-c']);
  });

  it('opens on the tab asked for, and filters the rows when another is picked', () => {
    const tree = render({ ...REQUEST, initialSectionId: 'one' });
    expect(rows(tree)).toEqual(['row-a']);
    act(() => {
      tree.root.findByType('PillTabs' as never).props.onTabChange('two');
    });
    expect(rows(tree)).toEqual(['row-b', 'row-c']);
  });

  it('draws the current choice at full strength, announced as selected', () => {
    const tree = render(REQUEST);
    const selected = row(tree, 'row-b').props;
    expect(selected.selected).toBe(true);
    expect(selected.disabled).toBeUndefined();
    expect(selected.subtitle).toBe('About B');
    // The check sits in the trailing slot.
    let trailing!: TestRenderer.ReactTestRenderer;
    act(() => {
      trailing = TestRenderer.create(selected.trailing);
    });
    expect(trailing.root.findAllByType('Icon' as never)[0].props.name).toBe('mdi:check-circle');
  });

  it('dims a disabled row and puts its reason under the title', () => {
    const tree = render(REQUEST);
    expect(row(tree, 'row-c').props).toMatchObject({ disabled: true, subtitle: 'Not now' });
  });

  it('answers with the row or the footer button tapped', () => {
    const tree = render(REQUEST);
    act(() => {
      row(tree, 'row-b').props.onPress();
    });
    expect(mockPick).toHaveBeenLastCalledWith({ kind: 'option', id: 'b' });
    const [button] = tree.root.findByType('ButtonHandler' as never).props.buttons;
    expect(button).toMatchObject({ text: 'New', testID: 'pick-new' });
    act(() => {
      button.onPress();
    });
    expect(mockPick).toHaveBeenLastCalledWith({ kind: 'action', id: 'new' });
  });

  it('draws no tab bar for a single tab with rows', () => {
    const tree = render({ ...REQUEST, sections: REQUEST.sections!.slice(0, 2) });
    expect(tree.root.findAllByType('PillTabs' as never)).toHaveLength(0);
    expect(rows(tree)).toEqual(['row-a']);
    expect(tree.root.findAllByProps({ testID: 'picker-sheet' })).not.toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'pick-list' })).not.toHaveLength(0);
  });
});
