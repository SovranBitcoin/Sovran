import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ThreadEmbedSheet } from '@/features/feed/components/thread-embed/ThreadEmbedSheet';
const mockView = View;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: React.PropsWithChildren) => children,
  Gesture: {
    Native: () => ({}),
    Pan: () => {
      const gesture = {
        enabled: () => gesture,
        activeOffsetY: () => gesture,
        simultaneousWithExternalGesture: () => gesture,
        onStart: () => gesture,
        onUpdate: () => gesture,
        onEnd: () => gesture,
      };
      return gesture;
    },
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: (props: object) => require('react').createElement(mockView, props) },
  useSharedValue: () => ({ get: () => 0 }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  interpolate: () => 0,
}));
jest.mock('@/features/feed/components/thread-embed/ThreadEmbedProvider', () => ({
  useThreadEmbed: () => ({ expandedOffset: 104, embedUrl: null }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'canvas' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: object) => require('react').createElement(mockView, props),
}));
jest.mock('@/shared/ui/composed/SheetGrabber', () => ({ SheetGrabber: () => null }));
jest.mock('@/features/feed/components/thread-embed/embedHaptics', () => ({
  embedHaptic: jest.fn(),
}));

it('lets the thread viewport extend behind navigation instead of permanently clipping below it', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ThreadEmbedSheet>
        <ScrollView />
      </ThreadEmbedSheet>
    );
  });
  const sheet = tree.root
    .findAllByType(View)
    .find((node) => StyleSheet.flatten(node.props.style)?.position === 'absolute');
  expect(StyleSheet.flatten(sheet?.props.style).top).toBe(0);
  act(() => tree.unmount());
});
