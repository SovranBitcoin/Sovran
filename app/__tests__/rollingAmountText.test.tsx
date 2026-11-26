/**
 * @jest-environment node
 *
 * The rolling balance: which digits roll, which way, when it snaps, and that
 * a screen reader hears one amount. Reanimated is mocked so a spring holds at
 * its start (progress 0): an incoming glyph's offset is then the full roll
 * distance, signed by direction (+ = entering from below, rolling up).
 */

import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { View } from 'react-native';

import { RollingAmountText } from '@/shared/ui/composed/RollingAmountText';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockReducedMotion = false;

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: { Text: 'AnimatedText' },
    useReducedMotion: () => mockReducedMotion,
    // A set re-renders, standing in for the UI thread re-reading the style.
    useSharedValue: (initial: number) => {
      const [, rerender] = ReactActual.useReducer((n: number) => n + 1, 0);
      return ReactActual.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(next: number) {
          if (next === this.value) return;
          this.value = next;
          rerender();
        },
      }))[0];
    },
    // Hold every roll at its first frame.
    withSpring: () => 0,
    cancelAnimation: () => {},
    useAnimatedStyle: (factory: () => object) => factory(),
  };
});

const STYLE = { fontSize: 20, lineHeight: 24 };

function render(props: { text: string; numericValue?: number; formatKey?: string }) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<RollingAmountText style={STYLE} {...props} />);
  });
  return {
    renderer,
    update: (next: typeof props) =>
      act(() => renderer.update(<RollingAmountText style={STYLE} {...next} />)),
  };
}

const byTestId = (root: ReactTestInstance, id: string) =>
  root.findAll(
    (n) => n.props.testID === id && (n.type === View || (n.type as unknown) === 'AnimatedText')
  );

/** translateY of a slot's glyph, from the flattened animated style. */
function offsetOf(root: ReactTestInstance, id: string): number | undefined {
  const [node] = byTestId(root, id);
  if (!node) return undefined;
  const styles = ([] as unknown[]).concat(node.props.style).flat(Infinity) as {
    transform?: { translateY: number }[];
  }[];
  const transform = styles.find((s) => s && s.transform)?.transform;
  return transform?.[0].translateY;
}

const rolling = (root: ReactTestInstance) =>
  root
    .findAll(
      (n) =>
        (n.type as unknown) === 'AnimatedText' &&
        typeof n.props.testID === 'string' &&
        n.props.testID.endsWith('-out')
    )
    .map((n) => (n.props.testID as string).replace(/^amount-slot-|-out$/g, ''));

beforeEach(() => {
  mockReducedMotion = false;
});

describe('RollingAmountText', () => {
  it('mounts settled: no digit rolls on first paint', () => {
    const { renderer } = render({ text: '₿ 1,250', numericValue: 1250, formatKey: 'sat:0' });
    expect(rolling(renderer.root)).toEqual([]);
    expect(offsetOf(renderer.root, 'amount-slot-int-0-in')).toBe(0);
  });

  it('rolls only the digits that changed, up on an increase', () => {
    const { renderer, update } = render({ text: '1,250', numericValue: 1250, formatKey: 'k' });
    update({ text: '1,260', numericValue: 1260, formatKey: 'k' });
    expect(rolling(renderer.root)).toEqual(['int-1']);
    expect(offsetOf(renderer.root, 'amount-slot-int-1-in')).toBe(24);
    expect(offsetOf(renderer.root, 'amount-slot-int-1-out')).toBe(0);
    expect(offsetOf(renderer.root, 'amount-slot-int-0-in')).toBe(0);
  });

  it('rolls down on a decrease, and a carry or borrow follows the value', () => {
    const up = render({ text: '9', numericValue: 9, formatKey: 'k' });
    up.update({ text: '10', numericValue: 10, formatKey: 'k' });
    // 9 → 0 is a carry on an increase: it rolls up, not down.
    expect(offsetOf(up.renderer.root, 'amount-slot-int-0-in')).toBe(24);

    const down = render({ text: '10', numericValue: 10, formatKey: 'k' });
    down.update({ text: '9', numericValue: 9, formatKey: 'k' });
    // 0 → 9 is a borrow on a decrease: it rolls down.
    expect(offsetOf(down.renderer.root, 'amount-slot-int-0-in')).toBe(-24);
  });

  it('keeps the low digits mounted when the amount gains a digit', () => {
    const { renderer, update } = render({ text: '999', numericValue: 999, formatKey: 'k' });
    const before = byTestId(renderer.root, 'amount-slot-int-0')[0];
    expect(before).toBeDefined();
    update({ text: '1,000', numericValue: 1000, formatKey: 'k' });
    expect(byTestId(renderer.root, 'amount-slot-int-0')[0]).toBe(before);
    expect(rolling(renderer.root)).toEqual(['int-2', 'int-1', 'int-0']);
  });

  it('snaps on a denomination switch', () => {
    const { renderer, update } = render({
      text: '₿ 1,250',
      numericValue: 1250,
      formatKey: 'sat:0',
    });
    update({ text: '1,251 sats', numericValue: 1250, formatKey: 'sat:2' });
    expect(rolling(renderer.root)).toEqual([]);
    expect(offsetOf(renderer.root, 'amount-slot-int-0-in')).toBe(0);
  });

  it('snaps under reduced motion', () => {
    mockReducedMotion = true;
    const { renderer, update } = render({ text: '1,250', numericValue: 1250, formatKey: 'k' });
    update({ text: '1,260', numericValue: 1260, formatKey: 'k' });
    expect(rolling(renderer.root)).toEqual([]);
  });

  it('reads as one element labelled with the whole amount', () => {
    const { renderer } = render({ text: '+ 42 sats', numericValue: 42, formatKey: 'k' });
    const labelled = renderer.root.findAll(
      (n) => n.type === View && n.props.accessibilityLabel !== undefined
    );
    expect(labelled).toHaveLength(1);
    expect(labelled[0].props.accessible).toBe(true);
    expect(labelled[0].props.accessibilityLabel).toBe('+ 42 sats');
    const hidden = renderer.root.findAll(
      (n) => n.type === View && n.props.importantForAccessibility === 'no-hide-descendants'
    );
    expect(hidden).toHaveLength(1);
    expect(hidden[0].props.accessibilityElementsHidden).toBe(true);
  });
});
