import { act, create } from 'react-test-renderer';
import { cancelAnimation, useReducedMotion, withTiming } from 'react-native-reanimated';
import { MarqueeText } from '@/shared/ui/primitives/MarqueeText';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ fontScale: 1 }),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: (effect: () => void | (() => void), enabled: boolean) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      if (enabled) return effect();
    }, [effect, enabled]);
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) =>
    jest.requireActual<typeof import('react')>('react').useRef({ value }).current,
  useAnimatedStyle: (factory: () => object) => factory(),
  useReducedMotion: jest.fn(() => false),
  cancelAnimation: jest.fn(),
  Easing: { linear: jest.fn() },
  withTiming: jest.fn((value: number) => value),
  withDelay: (_delay: number, value: number) => value,
  withRepeat: (value: number) => value,
  withSequence: (value: number) => value,
}));

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

async function measure(renderer: ReturnType<typeof create>, textWidth: number) {
  await act(async () => {
    renderer.root
      .findAll(
        (node) => node.props.testID === 'title' && typeof node.props.onLayout === 'function'
      )[0]
      .props.onLayout({
        nativeEvent: { layout: { width: 100 } },
      });
    renderer.root
      .findAll(
        (node) =>
          !node.props.testID &&
          typeof node.props.onLayout === 'function' &&
          typeof node.props.children === 'string'
      )[0]
      .props.onLayout({
        nativeEvent: { layout: { width: textWidth } },
      });
  });
}

it('animates two overflowing copies, hides the duplicate from accessibility, and cancels when paused', async () => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<MarqueeText text="A long title" testID="title" />);
  });
  await measure(renderer, 252);
  expect(withTiming).toHaveBeenCalledWith(-300, { duration: 10000, easing: expect.any(Function) });
  const copies = renderer.root.findAll((node) => String(node.type) === 'AnimatedView')[0].children;
  expect(copies).toHaveLength(2);
  expect(
    renderer.root.findAll(
      (node) => node.props.testID === 'title' && typeof node.props.onLayout === 'function'
    )[0].props.accessibilityLabel
  ).toBe('A long title');
  expect(
    renderer.root.findAll(
      (node) =>
        String(node.type) === 'Text' &&
        node.props.importantForAccessibility === 'no-hide-descendants'
    )
  ).toHaveLength(1);
  jest.mocked(cancelAnimation).mockClear();
  await act(async () => {
    renderer.update(<MarqueeText text="A long title" testID="title" active={false} />);
  });
  expect(cancelAnimation).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it.each([false, true])(
  'keeps fitting or reduced-motion text static (reduced motion: %s)',
  async (reduced) => {
    jest.mocked(useReducedMotion).mockReturnValue(reduced);
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<MarqueeText text="Title" testID="title" />);
    });
    await measure(renderer, reduced ? 252 : 80);
    expect(renderer.root.findAll((node) => String(node.type) === 'AnimatedView')).toHaveLength(0);
    expect(withTiming).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  }
);
