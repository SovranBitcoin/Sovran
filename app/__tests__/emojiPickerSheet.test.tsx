/**
 * @jest-environment node
 *
 * The emoji sheet's page: category tabs keep their selectors, a tapped emoji
 * answers the opener, and a search with no match says so.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { emojiPickerOptionTestID } from '@/shared/lib/popup/popups/emojiPickerIds';
import { EmojiPickerSheetScreen } from '@/shared/ui/composed/EmojiPickerSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPick = jest.fn();
jest.mock('@/shared/lib/picker/useSheetRouteScreen', () => ({
  useSheetRouteScreen: () => mockPick,
}));
jest.mock('@/shared/hooks/useThemeColor', () => {
  // `withAlpha` needs a real colour; any token will do.
  const { INVARIANT_BLACK } = jest.requireActual<typeof import('@/shared/lib/brandColors')>(
    '@/shared/lib/brandColors'
  );
  return { useThemeColor: (tokens: readonly string[]) => tokens.map(() => INVARIANT_BLACK) };
});
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log: { ...entry, child: () => entry },
    useMountLog: jest.fn(),
    useRenderLogger: jest.fn(),
  };
});

const element = (name: string) =>
  function MockElement({ children, ...props }: { children?: React.ReactNode }) {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(name, props, children);
  };
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: element('Screen'),
  useScreenOptions: jest.fn(),
}));
jest.mock('@/shared/ui/composed/PickerSheet', () => ({ renderSheetCloseButton: () => null }));
jest.mock('@/shared/ui/composed/SectionAnchorList', () => ({
  SectionAnchorList: element('SectionAnchorList'),
}));
jest.mock('@/shared/ui/composed/List', () => ({ List: element('List') }));
jest.mock('@/shared/lib/popup/SheetSearchField', () => ({
  SheetSearchField: element('SheetSearchField'),
}));
jest.mock('@/shared/ui/primitives/AnimatedEmoji', () => ({
  prefetchAnimatedEmojis: jest.fn(async () => {}),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: element('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: element('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: element('View') }));
jest.mock('assets/icons', () => ({ __esModule: true, CurrencyIcon: element('CurrencyIcon') }));

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<EmojiPickerSheetScreen />);
  });
  return tree;
}

const list = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findByType('SectionAnchorList' as never).props;

beforeEach(() => {
  jest.useFakeTimers();
  mockPick.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('EmojiPickerSheetScreen', () => {
  it('keeps a tab selector per category', () => {
    const tabs = list(render()).sections.map(
      (section: { anchor: { testID: string } }) => section.anchor.testID
    );
    expect(tabs).toContain('emoji-tab-bitcoin');
    expect(tabs.every((id: string) => id.startsWith('emoji-tab-'))).toBe(true);
  });

  it('answers the opener with the emoji tapped', () => {
    const tree = render();
    const { renderRow, sections } = list(tree);
    const first = sections[0].data[0];
    let row!: TestRenderer.ReactTestRenderer;
    act(() => {
      row = TestRenderer.create(renderRow([first]));
    });
    act(() => {
      row.root.findByProps({ testID: emojiPickerOptionTestID(first.emoji) }).props.onPress();
    });
    expect(mockPick).toHaveBeenCalledWith({ kind: 'option', id: first.emoji });
  });

  it('says so when a search finds nothing', () => {
    const tree = render();
    // The field sits above the tabs, in the list's `aboveAnchors` slot.
    const search = list(tree).aboveAnchors.props.children;
    expect(search.props.testID).toBe('emoji-picker-search');
    act(() => {
      search.props.onChangeText('zzzzzzzz');
      jest.advanceTimersByTime(200);
    });
    const override = list(tree).overrideContent;
    expect(override.props.testID).toBe('emoji-picker-no-results');
  });
});
