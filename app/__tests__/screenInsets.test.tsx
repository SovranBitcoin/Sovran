import React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  useScreenInsets,
  useScreenBottomPadding,
  useReportTabBarHeight,
  TabBarInsetsProvider,
  ConsumedBottomInsetContext,
  ScreenBottomPaddingContext,
} from '@/shared/hooks/useScreenInsets';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { List } from '@/shared/ui/composed/List';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockBottom = 34;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: mockBottom, left: 0, right: 0 }),
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: (props: object) =>
    require('react').createElement(require('react-native').View, {
      ...props,
      testID: 'flash-list',
    }),
}));

function Probe() {
  const insets = useScreenInsets();
  const padding = useScreenBottomPadding();
  const report = useReportTabBarHeight();
  return (
    <View
      testID="insets"
      accessibilityValue={{ now: insets.bottom }}
      style={{ paddingBottom: padding, marginBottom: insets.dockedTabBarHeight }}
      onLayout={(e) => report?.(e.nativeEvent.layout.height)}
    />
  );
}

const trees: TestRenderer.ReactTestRenderer[] = [];
function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(() => {
  act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

it.each(['ios', 'android'] as const)(
  'does not add tab or system space inside a docked %s viewport',
  (os) => {
    Platform.OS = os;
    mockBottom = 34;
    const tree = render(
      <TabBarInsetsProvider mode="docked">
        <Probe />
      </TabBarInsetsProvider>
    );
    const probe = tree.root.findByProps({ testID: 'insets' });
    expect(probe.props.accessibilityValue.now).toBe(0);
    expect(probe.props.style.paddingBottom).toBe(16);
    void act(() => probe.props.onLayout({ nativeEvent: { layout: { height: 86 } } }));
    expect(tree.root.findByProps({ testID: 'insets' }).props.style.marginBottom).toBe(86);
  }
);

it('uses native tab safe-area geometry once and responds to rotation', () => {
  mockBottom = 83;
  const tree = render(
    <TabBarInsetsProvider mode="native">
      <Probe />
    </TabBarInsetsProvider>
  );
  expect(tree.root.findByProps({ testID: 'insets' }).props.style.paddingBottom).toBe(99);
  mockBottom = 50;
  act(() =>
    tree.update(
      <TabBarInsetsProvider mode="native">
        <Probe />
      </TabBarInsetsProvider>
    )
  );
  expect(tree.root.findByProps({ testID: 'insets' }).props.style.paddingBottom).toBe(66);
});

it.each([0, 24, 34])('root modal scrollers reserve only their own %i system inset', (bottom) => {
  mockBottom = bottom;
  const tree = render(
    <>
      <TabBarInsetsProvider mode="docked">
        <View />
      </TabBarInsetsProvider>
      <Probe />
    </>
  );
  expect(tree.root.findByProps({ testID: 'insets' }).props.style.paddingBottom).toBe(bottom + 16);
});

it('does not repeat an inset consumed by a safe-area frame', () => {
  mockBottom = 34;
  const tree = render(
    <ConsumedBottomInsetContext.Provider value>
      <Probe />
    </ConsumedBottomInsetContext.Provider>
  );
  expect(tree.root.findByProps({ testID: 'insets' }).props.style.paddingBottom).toBe(16);
});

it('page lists and scrollers track footer growth and removal without losing other styles', () => {
  mockBottom = 34;
  const content = (footer: number) => (
    <ScreenBottomPaddingContext.Provider value={footer}>
      <ScreenScrollView contentContainerStyle={{ paddingTop: 80 }}>
        <View />
      </ScreenScrollView>
      <List screen data={[]} renderItem={() => null} contentContainerStyle={{ paddingTop: 80 }} />
    </ScreenBottomPaddingContext.Provider>
  );
  const tree = render(content(180));
  const check = (padding: number) => {
    for (const node of [
      tree.root.findByType(ScrollView),
      tree.root.findByProps({ testID: 'flash-list' }),
    ]) {
      expect(StyleSheet.flatten(node.props.contentContainerStyle)).toEqual({
        paddingTop: 80,
        paddingBottom: padding,
      });
      expect(node.props.contentInsetAdjustmentBehavior).toBe('never');
      expect(node.props.scrollIndicatorInsets.bottom).toBe(padding);
    }
  };
  check(180);
  act(() => tree.update(content(240)));
  check(240);
  act(() => tree.update(content(0)));
  check(50);
});

it('nested lists keep caller inset ownership', () => {
  const tree = render(
    <List
      data={[]}
      renderItem={() => null}
      contentContainerStyle={{ paddingBottom: 8 }}
      contentInsetAdjustmentBehavior="automatic"
    />
  );
  const list = tree.root.findByProps({ testID: 'flash-list' });
  expect(list.props.contentContainerStyle).toEqual({ paddingBottom: 8 });
  expect(list.props.contentInsetAdjustmentBehavior).toBe('automatic');
});

it('honors custom content spacing above a measured footer', () => {
  const tree = render(
    <ScreenBottomPaddingContext.Provider value={186}>
      <ScreenScrollView bottomSpacing={32}>
        <View />
      </ScreenScrollView>
    </ScreenBottomPaddingContext.Provider>
  );
  expect(
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom
  ).toBe(202);
});
