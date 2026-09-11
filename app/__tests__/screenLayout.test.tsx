import React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Screen } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { useScreenBackground, useScreenFooter } from '@/shared/ui/composed/ScreenFooterContext';

const mockScrollView = ScrollView;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({
  HeaderHeightContext: require('react').createContext(0),
}));
jest.mock('@/shared/ui/composed/AndroidSheetRoot', () => ({
  SheetHeaderHeightContext: require('react').createContext(null),
}));
jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({ FLOW_SHEET_SCRIM_OVERHANG: 32 }));
jest.mock('@/shared/ui/composed/ScrollEdgeFade', () => ({ ScrollEdgeFade: () => null }));
jest.mock('@/shared/hooks/useDeferredMount', () => ({ useDeferredMount: () => true }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string) => (token === 'surface' ? 'canvas-color' : 'background-color'),
}));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  log: { debug: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { ScrollView: (props: object) => require('react').createElement(mockScrollView, props) },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedScrollHandler: () => jest.fn(),
}));

const trees: TestRenderer.ReactTestRenderer[] = [];
function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(() => act(() => trees.splice(0).forEach((tree) => tree.unmount())));

function Footer({ height }: { height: number }) {
  const { setFooterHeight } = useScreenFooter();
  React.useLayoutEffect(() => setFooterHeight(height), [height, setFooterHeight]);
  return <View testID="footer" />;
}

it.each([
  ['ios', 'auto', 16, 'automatic'],
  ['android', 'auto', 50, 'automatic'],
  ['ios', 'animated', 50, 'never'],
  ['android', 'animated', 50, 'never'],
] as const)(
  '%s %s scrolling accounts for the bottom inset once',
  (os, scroll, padding, adjustment) => {
    Platform.OS = os;
    const tree = render(
      <Screen name="Test" scroll={scroll}>
        <View />
      </Screen>
    );
    const scroller = tree.root.findByType(ScrollView);
    expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingBottom).toBe(padding);
    expect(scroller.props.contentInsetAdjustmentBehavior).toBe(adjustment);
  }
);

it('custom page scrollers follow the actual footer measurement and removal', () => {
  Platform.OS = 'android';
  const content = (height?: number) => (
    <Screen name="Test" scroll="custom" footer={height ? <Footer height={height} /> : undefined}>
      <ScreenScrollView>
        <View />
      </ScreenScrollView>
    </Screen>
  );
  const tree = render(content(170));
  const padding = () =>
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom;
  expect(padding()).toBe(186);
  act(() => tree.update(content(240)));
  expect(padding()).toBe(256);
  act(() => tree.update(content()));
  expect(padding()).toBe(50);
});

it('safe-area frames consume the inset before descendant page scrolling', () => {
  const tree = render(
    <Screen name="Test" scroll="custom" safeArea>
      <ScreenScrollView>
        <View />
      </ScreenScrollView>
    </Screen>
  );
  expect(
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom
  ).toBe(16);
});

it('automatic iOS scrolling subtracts the native inset from already measured footer clearance', () => {
  Platform.OS = 'ios';
  const tree = render(
    <Screen name="Test" footer={<Footer height={170} />}>
      <View />
    </Screen>
  );
  expect(
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom
  ).toBe(152);
});

function BackgroundProbe() {
  return <View testID="background-probe" accessibilityLabel={useScreenBackground() ?? ''} />;
}

it.each([undefined, 'custom-page-color'])(
  'shares the painted page color with descendants (override: %s)',
  (bgColor) => {
    const tree = render(
      <Screen name="Test" scroll="custom" bgColor={bgColor}>
        <BackgroundProbe />
      </Screen>
    );
    const expected = bgColor ?? 'canvas-color';
    expect(tree.root.findByProps({ testID: 'background-probe' }).props.accessibilityLabel).toBe(
      expected
    );
    const paintedViews = tree.root
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style)?.backgroundColor === expected);
    expect(paintedViews.length).toBeGreaterThan(0);
  }
);
