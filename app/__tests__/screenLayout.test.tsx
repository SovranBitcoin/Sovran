import React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Screen } from '@/shared/ui/composed/Screen';
import { List } from '@/shared/ui/composed/List';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { useScreenBackground, useScreenFooter } from '@/shared/ui/composed/ScreenFooterContext';

const mockScrollView = ScrollView;
const mockView = View;
const mockSetOptions = jest.fn();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@shopify/flash-list', () => ({
  FlashList: (props: object) => require('react').createElement('test-list', props),
}));
jest.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: mockSetOptions }) }));
jest.mock('expo-router/react-navigation', () => ({
  HeaderHeightContext: require('react').createContext(0),
}));
jest.mock('@/shared/ui/composed/AndroidSheetRoot', () => ({
  SheetHeaderHeightContext: require('react').createContext(null),
}));
jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({
  FLOW_SHEET_SCRIM_OVERHANG: 32,
  FlowSheetHeader: () => null,
}));
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
  default: {
    ScrollView: (props: object) => require('react').createElement(mockScrollView, props),
    View: (props: object) => require('react').createElement(mockView, props),
  },
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
  ['ios', 'auto', 50, 'never'],
  ['android', 'auto', 50, 'never'],
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

it.each(['ios', 'android'] as const)(
  'custom tab screens reserve the transparent header exactly once on %s',
  (os) => {
    Platform.OS = os;
    const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
    const tree = render(
      <HeaderHeightContext.Provider value={104}>
        <Screen name="Tab" scroll="custom" safeArea>
          <View testID="pinned-filters" />
          <ScreenScrollView>
            <View />
          </ScreenScrollView>
        </Screen>
      </HeaderHeightContext.Provider>
    );
    const frames = tree.root
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style)?.paddingTop === 104);
    expect(frames).toHaveLength(1);
    const scroller = tree.root.findByType(ScrollView);
    expect(scroller.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingBottom).toBe(16);
  }
);

it('explicit iOS scrolling preserves already measured footer clearance', () => {
  Platform.OS = 'ios';
  const tree = render(
    <Screen name="Test" footer={<Footer height={170} />}>
      <View />
    </Screen>
  );
  expect(
    StyleSheet.flatten(tree.root.findByType(ScrollView).props.contentContainerStyle).paddingBottom
  ).toBe(186);
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

it.each(['ios', 'android'] as const)('uses navigator and measured sticky heights on %s', (os) => {
  Platform.OS = os;
  const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
  const onHeaderHeightChange = jest.fn();
  const tree = render(
    <HeaderHeightContext.Provider value={104}>
      <Screen
        name="Sticky"
        stickyContent={<View testID="tabs" />}
        onHeaderHeightChange={onHeaderHeightChange}>
        <View testID="body" />
      </Screen>
    </HeaderHeightContext.Provider>
  );
  const sticky = tree.root.findAll(
    (node) =>
      typeof node.props.onLayout === 'function' && StyleSheet.flatten(node.props.style)?.top === 104
  )[0];
  expect(parseFloat(String(StyleSheet.flatten(sticky.props.style).top))).toBe(104);
  act(() => {
    sticky.props.onLayout({ nativeEvent: { layout: { height: 62 } } });
  });
  expect(onHeaderHeightChange).toHaveBeenLastCalledWith(166);
  const scroller = tree.root.findByType(ScrollView);
  expect(scroller.props.children[0].props.style.height).toBe(166);
  expect(scroller.props.contentInsetAdjustmentBehavior).toBe('never');
});

it.each(['auto', 'animated', 'custom'] as const)(
  'keeps the iOS header fade above resting content in %s screens',
  (scroll) => {
    Platform.OS = 'ios';
    const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
    const { ScrollEdgeFade } = jest.requireMock('@/shared/ui/composed/ScrollEdgeFade');
    const tree = render(
      <HeaderHeightContext.Provider value={104}>
        <Screen name="RestingContent" scroll={scroll} safeArea={scroll === 'custom'}>
          <View testID="first-row" />
        </Screen>
      </HeaderHeightContext.Provider>
    );
    const fade = tree.root.findByType(ScrollEdgeFade);
    // Both the color and native blur must end before the first row at y=104.
    expect(fade.props.height).toBeLessThanOrEqual(104);
  }
);

it.each(['ios', 'android'] as const)(
  'uses a solid navigation band above pinned selectors on %s',
  (os) => {
    Platform.OS = os;
    const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
    const { ScrollEdgeFade } = jest.requireMock('@/shared/ui/composed/ScrollEdgeFade');
    const tree = render(
      <HeaderHeightContext.Provider value={104}>
        <Screen
          name="Receive"
          headerAppearance="opaque"
          stickyContent={<View testID="rail-tabs" />}>
          <View testID="qr" />
        </Screen>
      </HeaderHeightContext.Provider>
    );
    expect(tree.root.findAllByType(ScrollEdgeFade)).toHaveLength(0);
    const band = tree.root.findAllByType(View).find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.position === 'absolute' && style?.top === 0 && style?.height === 104;
    });
    expect(StyleSheet.flatten(band?.props.style).backgroundColor).toBe('canvas-color');
  }
);

it('uses the same solid band and clearance in Android sheets, restoring the fade on change', () => {
  Platform.OS = 'android';
  const { SheetHeaderHeightContext } = jest.requireMock('@/shared/ui/composed/AndroidSheetRoot');
  const content = (appearance: 'opaque' | 'gradient') => (
    <SheetHeaderHeightContext.Provider value={74}>
      <Screen name="Sheet" scroll="custom" safeArea headerAppearance={appearance}>
        <View testID="filters" />
      </Screen>
    </SheetHeaderHeightContext.Provider>
  );
  mockSetOptions.mockClear();
  const tree = render(content('opaque'));
  const headerOptions = mockSetOptions.mock.calls.find(([options]) => options.header);
  expect(headerOptions?.[0].header({}).props.appearance).toBe('opaque');
  expect(mockSetOptions.mock.calls.some(([options]) => 'headerBackground' in options)).toBe(false);
  const topPadding = () =>
    tree.root
      .findAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style)?.paddingTop)
      .filter((padding) => padding !== undefined);
  expect(topPadding()).toEqual([74]);
  act(() => tree.update(content('gradient')));
  expect(mockSetOptions.mock.calls.at(-1)?.[0].header({}).props.appearance).toBe('gradient');
  expect(topPadding()).toEqual([106]);
});

it.each(['ios', 'android'] as const)(
  'lets Settings-style custom scrolling pass behind the gradient on %s',
  (os) => {
    Platform.OS = os;
    const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
    const tree = render(
      <HeaderHeightContext.Provider value={104}>
        <Screen name="Settings" scroll="custom" safeArea="scroll">
          <ScreenScrollView>
            <View testID="account" />
          </ScreenScrollView>
        </Screen>
      </HeaderHeightContext.Provider>
    );
    const scroller = tree.root.findByType(ScrollView);
    const content = StyleSheet.flatten(scroller.props.contentContainerStyle);
    expect(content.paddingTop).toBe(104);
    expect(content.paddingBottom).toBe(50);
    // A fixed frame would prevent any row ever reaching the gradient on scroll.
    let ancestor = scroller.parent;
    while (ancestor) {
      expect(StyleSheet.flatten(ancestor.props.style)?.paddingTop).not.toBe(104);
      ancestor = ancestor.parent;
    }
    expect(scroller.props.contentInsetAdjustmentBehavior).toBe('never');
  }
);

it.each([{ paddingTop: 12 }, { paddingVertical: 12 }, { padding: 12 }])(
  'gives detail lists scrolling clearance and preserves local spacing %j',
  (localSpacing) => {
    Platform.OS = 'ios';
    const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
    const tree = render(
      <HeaderHeightContext.Provider value={104}>
        <Screen name="History" scroll="custom" safeArea="scroll">
          <List screen data={[]} renderItem={() => null} contentContainerStyle={localSpacing} />
        </Screen>
      </HeaderHeightContext.Provider>
    );
    const { FlashList } = jest.requireMock('@shopify/flash-list');
    const list = tree.root.findByType(FlashList);
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
      paddingTop: 116,
      paddingBottom: 50,
    });
    expect(list.props.scrollIndicatorInsets.top).toBe(104);
    expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
  }
);

it.each(['ios', 'android'] as const)('fades across navigation and horizontal tabs on %s', (os) => {
  Platform.OS = os;
  const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
  const { ScrollEdgeFade } = jest.requireMock('@/shared/ui/composed/ScrollEdgeFade');
  const tree = render(
    <HeaderHeightContext.Provider value={104}>
      <Screen
        name="MintTabs"
        headerAppearance="gradient-tabs"
        stickyContentHeight={56}
        stickyContent={<View testID="horizontal-tabs" />}>
        <View />
      </Screen>
    </HeaderHeightContext.Provider>
  );
  expect(tree.root.findByType(ScrollEdgeFade).props.height).toBe(160);
  expect(tree.root.findByType(ScrollEdgeFade).props.colorFadeEnd).toBe(1);
  const sticky = tree.root
    .findAllByType(View)
    .find((node) => StyleSheet.flatten(node.props.style)?.top === 104);
  expect(StyleSheet.flatten(sticky?.props.style).backgroundColor).toBe('transparent');
  const scroller = tree.root.findByType(ScrollView);
  expect(scroller.props.children[0].props.style.height).toBe(160);
});

it('owns one combined fade across an Android sheet bar and currency strip', () => {
  Platform.OS = 'android';
  const { SheetHeaderHeightContext } = jest.requireMock('@/shared/ui/composed/AndroidSheetRoot');
  const { ScrollEdgeFade } = jest.requireMock('@/shared/ui/composed/ScrollEdgeFade');
  mockSetOptions.mockClear();
  const tree = render(
    <SheetHeaderHeightContext.Provider value={74}>
      <Screen
        name="Currencies"
        headerAppearance="gradient-tabs"
        stickyContentHeight={56}
        stickyContent={<View />}>
        <View />
      </Screen>
    </SheetHeaderHeightContext.Provider>
  );
  expect(tree.root.findAllByType(ScrollEdgeFade)).toHaveLength(1);
  expect(tree.root.findByType(ScrollEdgeFade).props.height).toBe(130);
  expect(mockSetOptions.mock.calls.at(-1)?.[0].header({}).props.appearance).toBe('gradient-tabs');
  expect(tree.root.findByType(ScrollView).props.children[0].props.style.height).toBe(130);
});

it('keeps the animated profile fade in a full-size, noninteractive overlay', () => {
  Platform.OS = 'ios';
  const { HeaderHeightContext } = jest.requireMock('expo-router/react-navigation');
  const tree = render(
    <HeaderHeightContext.Provider value={104}>
      <Screen name="Profile" headerGradientStyle={{ opacity: 0.5 }}>
        <View />
      </Screen>
    </HeaderHeightContext.Provider>
  );
  const overlay = tree.root
    .findAllByType(View)
    .find((node) => StyleSheet.flatten(node.props.style)?.opacity === 0.5);
  expect(StyleSheet.flatten(overlay?.props.style)).toMatchObject({
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  expect(overlay?.props.pointerEvents).toBe('none');
});
