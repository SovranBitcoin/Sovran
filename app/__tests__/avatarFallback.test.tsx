/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { sanitizeAvatarFallbackSeed } from '@/shared/lib/avatarFallback';
import { generateClayAvatarTheme, generateSeededGradient } from '@/shared/lib/avatarGradient';
import { Avatar } from '@/shared/ui/primitives/Avatar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'expo-image', ...props });
  },
}));

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  const createSvgHost =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.createElement(name, props, children);

  return {
    __esModule: true,
    default: createSvgHost('Svg'),
    Svg: createSvgHost('Svg'),
    Circle: createSvgHost('Circle'),
    Defs: createSvgHost('Defs'),
    Ellipse: createSvgHost('Ellipse'),
    G: createSvgHost('G'),
    LinearGradient: createSvgHost('LinearGradient'),
    Path: createSvgHost('Path'),
    RadialGradient: createSvgHost('RadialGradient'),
    Rect: createSvgHost('Rect'),
    Stop: createSvgHost('Stop'),
  };
});

jest.mock('@/shared/lib/imageCache', () => ({
  prefetchImage: jest.fn(),
}));

jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  applyFileLogging: jest.fn(),
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : 'theme-single',
}));

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn(() => 'rgba(0,0,0,0.07)'),
}));

jest.mock(
  'assets/icons',
  () => ({
    __esModule: true,
    default: ({ name, ...props }: { name: string }) => {
      const ReactActual = jest.requireActual<typeof import('react')>('react');
      const { View } = jest.requireActual<typeof import('react-native')>('react-native');
      return ReactActual.createElement(View, { testID: `icon-${name}`, ...props });
    },
  }),
  { virtual: true }
);

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

describe('avatar fallback rendering', () => {
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('props.pointerEvents is deprecated')) return;
      throw new Error(`Unexpected console.warn: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('sanitizes fallback seeds into stable SVG-safe strings', () => {
    expect(sanitizeAvatarFallbackSeed(' Alice/#1 ')).toBe('Alice_2f_231');
    expect(sanitizeAvatarFallbackSeed('')).toBe('avatar');
  });

  it('renders the clay silhouette with the sanitized seed', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const rawSeed = 'npub 123/#?';
    const sanitizedSeed = sanitizeAvatarFallbackSeed(rawSeed);

    act(() => {
      renderer = TestRenderer.create(
        <Avatar state="fallback" seed={rawSeed} alt="Unsafe avatar seed" size={40} />
      );
    });

    const svg = renderer!.root.findByProps({ testID: 'clay-silhouette-avatar' });
    expect(svg.props.width).toBe(40);
    expect(svg.props.height).toBe(40);
    expect(svg.props.viewBox).toBe('0 0 24 24');

    // The gradient ids embed the sanitized seed, proving raw seeds never leak
    // into SVG ids.
    const background = renderer!.root.findByProps({ testID: 'clay-avatar-background' });
    expect(background.props.fill).toBe(`url(#clay-${sanitizedSeed}-bg)`);

    act(() => {
      renderer.unmount();
    });
  });

  it('renders deterministic clay layers from the seeded theme', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const seed = 'npub-test-seed';
    const theme = generateClayAvatarTheme(seed);

    act(() => {
      renderer = TestRenderer.create(
        <Avatar state="fallback" seed={seed} alt="Clay avatar" size={48} />
      );
    });

    const stops = renderer!.root.findAllByType('Stop' as never);
    const stopColors = stops.map((stop) => stop.props.stopColor);
    expect(stopColors).toEqual([
      theme.bgStart,
      theme.bgEnd,
      theme.bodyTop,
      theme.bodyBottom,
      theme.highlight,
      theme.highlight,
      theme.highlight,
    ]);

    // All three layers present: background, body, specular. The body is ONE
    // path with one continuous gradient — no torso overlays (a layered
    // contact shadow read as a seam splitting the torso).
    expect(renderer!.root.findByProps({ testID: 'clay-avatar-background' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'clay-avatar-body' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'clay-avatar-specular' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'clay-avatar-ground' })).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('shares its hues with the profile banner seeded gradient', () => {
    const seed = 'npub-test-seed';
    const clay = generateClayAvatarTheme(seed);
    const banner = generateSeededGradient(seed);

    // The clay background starts on exactly the banner's mid color, so a
    // pubkey's fallback avatar and banner visibly harmonize.
    expect(clay.bgStart).toBe(banner.primaryColors[1]);
  });

  it('renders the identical composition at every size', () => {
    const seed = 'size-invariant-seed';
    const collectStops = (size: number) => {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <Avatar state="fallback" seed={seed} alt="Sized avatar" size={size} />
        );
      });
      const stops = renderer!.root
        .findAllByType('Stop' as never)
        .map((stop) => [stop.props.stopColor, stop.props.stopOpacity]);
      act(() => {
        renderer.unmount();
      });
      return stops;
    };

    expect(collectStops(24)).toEqual(collectStops(80));
  });
});
