import React from 'react';
import { Image } from 'expo-image';
import { fireEvent, render } from '@testing-library/react-native';

import { ImageBlock } from '../components/nostr/image-overlay/ImageBlock';

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['black'] }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('../components/nostr/image-overlay/provider', () => ({ useImageOverlay: () => null }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  feedLog: { info: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: jest.fn() }),
  useVisualLayoutLogger: () => ({}),
  urlHost: () => 'example.com',
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View', createAnimatedComponent: (component: unknown) => component },
  useAnimatedProps: (factory: () => unknown) => factory(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (value: number) => ({ value }),
}));

describe('ImageBlock recycling', () => {
  it('renders the next image with its own reserved geometry after a failed image is recycled', () => {
    const view = render(
      <ImageBlock url="https://example.com/failed.jpg" eventId="first" initialAspectRatio={2} />
    );
    const firstImage = view.UNSAFE_getByType(Image);
    fireEvent(firstImage, 'error');
    expect(view.getByText('Image unavailable — tap to open')).toBeTruthy();

    view.rerender(
      <ImageBlock url="https://example.com/next.jpg" eventId="second" initialAspectRatio={0.75} />
    );

    const nextImage = view.UNSAFE_getByType(Image);
    expect(nextImage.props.source.uri).toBe('https://example.com/next.jpg');
    expect(nextImage.props.style.aspectRatio).toBe(0.75);
    expect(view.queryByText('Image unavailable — tap to open')).toBeNull();
  });

  it('reserves a previously learned image ratio when recycling back to that URL', () => {
    const view = render(<ImageBlock url="https://example.com/cached.jpg" eventId="first" />);
    fireEvent(view.UNSAFE_getByType(Image), 'load', {
      source: { width: 300, height: 100 },
    });

    view.rerender(
      <ImageBlock
        url="https://example.com/portrait.jpg"
        eventId="second"
        initialAspectRatio={0.5}
      />
    );
    expect(view.UNSAFE_getByType(Image).props.style.aspectRatio).toBe(0.5);

    view.rerender(<ImageBlock url="https://example.com/cached.jpg" eventId="first" />);
    expect(view.UNSAFE_getByType(Image).props.style.aspectRatio).toBe(3);
  });
});
