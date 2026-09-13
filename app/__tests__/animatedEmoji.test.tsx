/** @jest-environment node */

import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Image } from 'expo-image';

import { prefetchImage } from '@/shared/lib/imageCache';
import { AnimatedEmoji, prefetchAnimatedEmojis } from '@/shared/ui/primitives/AnimatedEmoji';
import { Text } from '@/shared/ui/primitives/Text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockReducedMotion = false;

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => mockReducedMotion }));
jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'expo-image', ...props });
  },
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props);
  },
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('View', props);
  },
}));
jest.mock('@/shared/lib/imageCache', () => ({ prefetchImage: jest.fn(async () => {}) }));

let renderer: TestRenderer.ReactTestRenderer;

function render(emoji = '😂', size?: number) {
  act(() => {
    renderer = TestRenderer.create(<AnimatedEmoji emoji={emoji} size={size} />);
  });
}

function image() {
  return renderer.root.findByType(Image);
}

function glyph() {
  return renderer.root.findByType(Text);
}

beforeEach(() => {
  mockReducedMotion = false;
  jest.clearAllMocks();
});

afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

it.each([18, 28])('shows the glyph immediately at size %i until the image loads', (size) => {
  render('😂', size);
  expect(glyph().props.children).toBe('😂');
  expect(glyph().props.className).toContain('opacity-100');
  expect(StyleSheet.flatten(glyph().props.style).fontSize).toBe(size);
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
  expect(image().props.transition).toBe(0);
  expect(prefetchImage).not.toHaveBeenCalled();

  act(() => {
    image().props.onLoad();
  });

  expect(StyleSheet.flatten(image().props.style).opacity).toBe(1);
  // Noto's transparent pixels must not leave a second glyph showing through.
  expect(glyph().props.className).toContain('opacity-0');
});

it('keeps the glyph when loading fails', () => {
  render();
  act(() => {
    image().props.onError();
  });
  expect(glyph().props.children).toBe('😂');
  expect(glyph().props.className).toContain('opacity-100');
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
  act(() => {
    image().props.onLoad();
  });
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
});

it('swaps immediately and disables animated playback for reduced motion', () => {
  mockReducedMotion = true;
  render();
  expect(image().props.autoplay).toBe(false);
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
  act(() => {
    image().props.onLoad();
  });
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(1);
  expect(image().props.transition).toBe(0);
});

it.each(['loaded', 'failed'])('resets a %s image when the emoji changes', (status) => {
  render();
  const previousCallbacks = image().props;
  act(() => {
    previousCallbacks[status === 'loaded' ? 'onLoad' : 'onError']();
  });
  act(() => renderer.update(<AnimatedEmoji emoji="⚡" />));
  expect(glyph().props.children).toBe('⚡');
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
  // A late native completion from the previous emoji must not reveal this one.
  act(() => {
    previousCallbacks.onLoad();
  });
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(0);
  act(() => {
    image().props.onLoad();
  });
  expect(StyleSheet.flatten(image().props.style).opacity).toBe(1);
});

it('uses the same CDN URLs for rendering and the shared prefetch scheduler', async () => {
  const emojis = ['🛡️', '👩‍💻', '👍🏽'];
  await prefetchAnimatedEmojis(emojis);
  expect(jest.mocked(prefetchImage).mock.calls).toEqual([
    ['https://fonts.gstatic.com/s/e/notoemoji/latest/1f6e1/512.webp'],
    ['https://fonts.gstatic.com/s/e/notoemoji/latest/1f469_200d_1f4bb/512.webp'],
    ['https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d_1f3fd/512.webp'],
  ]);
  render(emojis[0]);
  expect(image().props.source.uri).toBe(jest.mocked(prefetchImage).mock.calls[0][0]);
});
