/**
 * A row with an interactive trailing control (the Select Mint three-dots
 * button) must keep two native targets, with the row's press feedback running
 * the full width UNDER the control rather than stopping short of it.
 */
import TestRenderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import { ListRow } from '@/shared/ui/composed/ListRow';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'grey') : 'grey',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (c: string) => c }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Pressable = (props: Record<string, unknown> & { testID?: string }) =>
    ReactActual.createElement(RNView, { ...props, testID: props.testID ?? 'pressable' });
  Pressable.Scale = (props: Record<string, unknown>) =>
    ReactActual.createElement(RNView, { ...props, testID: 'scale' });
  Pressable.Ripple = () => ReactActual.createElement(RNView, { testID: 'ripple' });
  return { PressableFeedback: Pressable };
});

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign(
    {},
    ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)
  );
}

it('spans the row pressable full width and overlays the trailing control as a sibling', () => {
  const trailing = <View testID="three-dots" />;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ListRow
        title="Mint"
        trailing={trailing}
        trailingInteractive
        onPress={() => {}}
        testID="row"
      />
    );
  });
  // The (mocked) pressable: the first `testID="row"` node below the ListRow
  // element itself, which carries the same testID prop.
  const pressable = renderer.root.findAll(
    (node) => node !== renderer.root && node.props.testID === 'row'
  )[0];
  const dots = renderer.root.findByProps({ testID: 'three-dots' });
  // The control is NOT inside the pressable (an accessible nested Pressable is
  // hidden from VoiceOver on iOS) ...
  expect(pressable.findAllByProps({ testID: 'three-dots' })).toHaveLength(0);
  // ... and the ripple lives in the full-width pressable, under the control.
  expect(pressable.findAllByProps({ testID: 'ripple' }).length).toBeGreaterThan(0);
  // The overlay wrapper (the RN View composite above the control's host node).
  const overlay = dots.parent!.parent!;
  expect(flatten(overlay.props.style)).toMatchObject({ position: 'absolute', right: 20 });

  // The body reserves the control's width (44 until measured) plus the row gap.
  const reservedRight = () =>
    pressable
      .findAll((node) => flatten(node.props.style).paddingRight !== undefined)
      .map((node) => flatten(node.props.style).paddingRight);
  expect(reservedRight()).toContain(56);
  void act(() => overlay.props.onLayout({ nativeEvent: { layout: { width: 32 } } }));
  expect(reservedRight()).toContain(44);
  expect(reservedRight()).not.toContain(56);
});

it('keeps the trailing control inside the pressable when it is not interactive', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ListRow title="Mint" trailing={<View testID="chevron" />} onPress={() => {}} testID="row" />
    );
  });
  // The (mocked) pressable: the first `testID="row"` node below the ListRow
  // element itself, which carries the same testID prop.
  const pressable = renderer.root.findAll(
    (node) => node !== renderer.root && node.props.testID === 'row'
  )[0];
  expect(pressable.findAllByProps({ testID: 'chevron' })).toHaveLength(1);
});
