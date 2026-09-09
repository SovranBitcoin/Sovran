import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  // eslint-disable-next-line no-restricted-syntax -- parseable fixture color
  useThemeColor: () => '#808080',
}));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/composed/BlurCardFrame', () => ({
  BlurCardFrame: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/SquircleView', () => ({
  SquircleView: ({ children, ...props }: React.PropsWithChildren) => {
    const Host = jest.requireActual<typeof import('react-native')>('react-native').View;
    return <Host {...props}>{children}</Host>;
  },
}));

it('keeps the same frame and content mounted while loading blocks visibility and interaction', () => {
  let mounts = 0;
  function Content() {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <View testID="content" />;
  }
  const card = (loading: boolean) => (
    <GradientCard loading={loading} variant="right" testID="frame">
      <Content />
    </GradientCard>
  );
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(card(true));
  });
  const frame = tree.root.findByType(BlurCardFrame);
  const contentHost = () =>
    tree.root.findAllByType(View).find((node) => node.props.accessibilityElementsHidden != null)!;
  expect(contentHost().props.className).toBe('opacity-0');
  expect(contentHost().props.pointerEvents).toBe('none');
  expect(contentHost().props.accessibilityElementsHidden).toBe(true);
  expect(contentHost().props.importantForAccessibility).toBe('no-hide-descendants');
  const geometry = contentHost().props.style;

  act(() => tree.update(card(false)));
  expect(tree.root.findByType(BlurCardFrame)).toBe(frame);
  expect(frame.props.variant).toBe('right');
  expect(contentHost().props.style).toEqual(geometry);
  expect(contentHost().props.className).toBeUndefined();
  expect(contentHost().props.pointerEvents).toBeUndefined();
  expect(contentHost().props.accessibilityElementsHidden).toBe(false);
  expect(contentHost().props.importantForAccessibility).toBe('auto');
  expect(mounts).toBe(1);
  act(() => tree.unmount());
});
