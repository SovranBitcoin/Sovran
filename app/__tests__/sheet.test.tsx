/**
 * @jest-environment node
 */

/**
 * The house bottom sheet (`Sheet`): its content mounts with the sheet (no
 * delayed mount gate), its wrappers stay out of the accessibility tree so the
 * rows inside remain reachable, the scrim asks to dismiss only when the sheet
 * is dismissable, the footer is drawn, the sheet reports when it has landed
 * and when it has gone, and a `SheetScrollView` inside a sheet cooperates
 * with the sheet's drag through a native gesture.
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { Sheet, SheetScrollView } from '@/shared/ui/composed/Sheet';
import { finishAnimations, resetAnimations } from './helpers/sheetRuntimeMocks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock(
  'react-native-keyboard-controller',
  () => require('./helpers/sheetRuntimeMocks').keyboardController
);
jest.mock('react-native-screens', () => require('./helpers/sheetRuntimeMocks').screens);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('react-native-safe-area-context', () => require('./helpers/sheetRuntimeMocks').safeArea);
jest.mock(
  'react-native-web/dist/exports/useWindowDimensions',
  () => require('./helpers/sheetRuntimeMocks').windowDimensions
);
jest.mock('@/shared/lib/logger', () => ({ log: { error: jest.fn(), warn: jest.fn() } }));

type Props = Partial<React.ComponentProps<typeof Sheet>>;

let renderer: TestRenderer.ReactTestRenderer | undefined;

function draw(props: Props = {}, children: React.ReactNode = <Text testID="body">Body</Text>) {
  return (
    <Sheet
      open
      onDismissRequest={() => {}}
      scrimColor="rgba(0,0,0,0.5)"
      scrimTestID="scrim"
      {...props}>
      {children}
    </Sheet>
  );
}

function mount(props: Props = {}, children?: React.ReactNode) {
  act(() => {
    renderer = TestRenderer.create(draw(props, children));
  });
  return renderer!;
}

/** The sheet surface: the view that measures itself to slide up. */
const panel = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll((node) => typeof node.props.onLayout === 'function' && node.props.className)[0]!;

/** The scrim's pressable (the composite that owns `onPress`, not its host). */
const scrim = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll((node) => node.props.testID === 'scrim' && 'accessibilityState' in node.props)[0]!;

function layOut(r: TestRenderer.ReactTestRenderer, height = 400) {
  act(() => {
    panel(r).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
  });
}

/** The vertical offset the surface is drawn at (0 = fully up). */
function offset(r: TestRenderer.ReactTestRenderer): number {
  const style = ([] as unknown[]).concat(panel(r).props.style).flat(Infinity) as {
    transform?: { translateY?: number }[];
  }[];
  return style.reduce(
    (value, entry) => entry?.transform?.find((step) => 'translateY' in step)?.translateY ?? value,
    Number.NaN
  );
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetAnimations();
});

describe('Sheet', () => {
  it('mounts its content on the first render, before it has been measured', () => {
    const r = mount();
    expect(r.root.findAllByProps({ testID: 'body' }).length).toBeGreaterThan(0);
    // Not measured yet: it waits below the window rather than holding the body back.
    expect(offset(r)).toBe(844);
  });

  it('keeps its wrappers out of the accessibility tree so the rows inside stay reachable', () => {
    const r = mount();
    // The outermost view the sheet draws holds the scrim and the surface.
    const overlay = r.root.findAll((node) => String(node.type) === 'GestureHandlerRootView')[0]!;
    const wrapper = overlay.findAll(
      (node) => node !== overlay && 'pointerEvents' in node.props
    )[0]!;
    expect(wrapper.props.pointerEvents).toBe('box-none');
    expect(wrapper.props.accessible).toBe(false);
    expect(wrapper.findAll((node) => node === scrim(r))).toHaveLength(1);
    expect(wrapper.findAll((node) => node === panel(r))).toHaveLength(1);
    // The sliding surface, which holds the content, is not one element either.
    expect(panel(r).props.accessible).toBe(false);
    expect(panel(r).findAllByProps({ testID: 'body' }).length).toBeGreaterThan(0);
  });

  it('asks to dismiss from the scrim only when it is dismissable', () => {
    const onDismissRequest = jest.fn();
    const r = mount({ onDismissRequest });
    expect(scrim(r).props.accessibilityLabel).toBe('Dismiss');
    expect(scrim(r).props.accessibilityState).toEqual({ disabled: false });
    act(() => {
      scrim(r).props.onPress();
    });
    expect(onDismissRequest).toHaveBeenCalledTimes(1);

    act(() => r.update(draw({ onDismissRequest, dismissable: false })));
    expect(scrim(r).props.accessibilityState).toEqual({ disabled: true });
    expect(scrim(r).props.onPress).toBeUndefined();
    expect(onDismissRequest).toHaveBeenCalledTimes(1);
  });

  it('turns the drag off when it is not dismissable', () => {
    const r = mount({ dismissable: false });
    const detector = r.root.findAll(
      (node) => String(node.type) === 'GestureDetector' && node.props.gesture.kind === 'pan'
    )[0]!;
    expect(detector.props.gesture.handlers.enabled).toBe(false);
  });

  it('does not dismiss when a drag is cancelled (success === false)', () => {
    const onDismissRequest = jest.fn();
    const r = mount({ onDismissRequest });
    layOut(r, 400);
    const detector = r.root.findAll(
      (node) => String(node.type) === 'GestureDetector' && node.props.gesture.kind === 'pan'
    )[0]!;
    act(() => {
      detector.props.gesture.handlers.onUpdate({ translationY: 200 });
      detector.props.gesture.handlers.onEnd({ velocityY: 1200 }, false);
    });
    expect(onDismissRequest).not.toHaveBeenCalled();
  });

  it('consumes Android hardware Back while open and closes when dismissable', () => {
    const { BackHandler, Platform } = require('react-native');
    const prevOS = Platform.OS;
    let backCallback: (() => boolean) | undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, cb) => {
      backCallback = cb as () => boolean;
      return { remove };
    });
    try {
      Platform.OS = 'android';
      const onDismissRequest = jest.fn();
      const r = mount({ onDismissRequest, dismissable: true });
      expect(backCallback).toBeDefined();
      expect(backCallback!()).toBe(true);
      expect(onDismissRequest).toHaveBeenCalledTimes(1);

      onDismissRequest.mockClear();
      act(() => r.update(draw({ onDismissRequest, dismissable: false })));
      expect(backCallback!()).toBe(true);
      expect(onDismissRequest).not.toHaveBeenCalled();
    } finally {
      Platform.OS = prevOS;
      spy.mockRestore();
    }
  });

  it('draws its footer', () => {
    const r = mount({ footer: <Text testID="footer">Continue</Text> });
    expect(panel(r).findAllByProps({ testID: 'footer' }).length).toBeGreaterThan(0);
  });

  it('slides up once measured and reports when it lands, then when it has gone', () => {
    const onPresented = jest.fn();
    const onClosed = jest.fn();
    const r = mount({ onPresented, onClosed });
    expect(onPresented).not.toHaveBeenCalled();
    layOut(r);
    expect(offset(r)).toBe(0);
    expect(onPresented).not.toHaveBeenCalled();
    act(() => finishAnimations());
    expect(onPresented).toHaveBeenCalledTimes(1);

    act(() => r.update(draw({ onPresented, onClosed, open: false })));
    // Still drawn while it slides away; the owner unmounts after onClosed.
    expect(offset(r)).toBe(400);
    expect(r.root.findAllByProps({ testID: 'body' }).length).toBeGreaterThan(0);
    expect(onClosed).not.toHaveBeenCalled();
    act(() => finishAnimations());
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onPresented).toHaveBeenCalledTimes(1);
  });
});

describe('SheetScrollView', () => {
  it('scrolls inside a sheet through the native gesture the sheet drags with', () => {
    const r = mount(
      {},
      <SheetScrollView testID="list">
        <Text testID="row">Row</Text>
      </SheetScrollView>
    );
    const scroll = r.root.findAll(
      (node) => node.props.testID === 'list' && typeof node.props.onScroll === 'function'
    )[0]!;
    expect(scroll.props.scrollEventThrottle).toBe(16);
    expect(scroll.findAllByProps({ testID: 'row' }).length).toBeGreaterThan(0);
    const detector = scroll.parent!;
    expect(String(detector.type)).toBe('GestureDetector');
    expect(detector.props.gesture.kind).toBe('native');
    // The sheet's pan runs alongside that same native gesture.
    const pan = r.root.findAll(
      (node) => String(node.type) === 'GestureDetector' && node.props.gesture.kind === 'pan'
    )[0]!;
    expect(pan.props.gesture.handlers.simultaneousWithExternalGesture).toBe(detector.props.gesture);
  });

  it('is a plain scroll view outside a sheet', () => {
    act(() => {
      renderer = TestRenderer.create(
        <SheetScrollView testID="list">
          <Text>Row</Text>
        </SheetScrollView>
      );
    });
    expect(renderer!.root.findAll((node) => String(node.type) === 'GestureDetector')).toHaveLength(
      0
    );
    expect(renderer!.root.findAllByProps({ testID: 'list' }).length).toBeGreaterThan(0);
  });
});
