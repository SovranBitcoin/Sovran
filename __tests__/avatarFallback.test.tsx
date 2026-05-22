/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  AVATAR_FALLBACK_COLOR_TOKENS,
  AVATAR_FALLBACK_VARIANT_LABELS,
  AVATAR_FALLBACK_VARIANTS,
  getAvatarFallbackColorsForVariant,
  sanitizeAvatarFallbackSeed,
} from '@/shared/lib/avatarFallback';
import { Avatar } from '@/shared/ui/primitives/Avatar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@mealection/react-native-boring-avatars', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'boring-avatar', ...props });
  },
}));

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'expo-image', ...props });
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { ...props });
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
    G: createSvgHost('G'),
    Mask: createSvgHost('Mask'),
    Path: createSvgHost('Path'),
    Rect: createSvgHost('Rect'),
  };
});

jest.mock('@/shared/lib/imageCache', () => ({
  prefetchImage: jest.fn(),
}));

jest.mock('@/shared/lib/logger', () => ({
  log: {
    warn: jest.fn(),
  },
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : 'theme-single',
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, string>) => unknown) =>
    selector({ avatarFallbackVariant: 'pixel' }),
}));

jest.mock('hex-color-opacity', () => jest.fn(() => 'rgba(0,0,0,0.07)'));

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

  it('only exposes glass, beam, and pixels as fallback options', () => {
    expect(AVATAR_FALLBACK_VARIANTS).toEqual(['beam', 'pixel', 'glass']);
    expect(AVATAR_FALLBACK_VARIANT_LABELS).toEqual({
      beam: 'Beam',
      pixel: 'Pixels',
      glass: 'Glass',
    });
  });

  it('uses stronger multicolor design-system tokens for every fallback variation', () => {
    expect(AVATAR_FALLBACK_COLOR_TOKENS).toHaveLength(12);
    expect(
      AVATAR_FALLBACK_COLOR_TOKENS.every((token) =>
        /^(blue|green|purple|yellow|orange|red)-(300|400)$/.test(token)
      )
    ).toBe(true);
    expect(AVATAR_FALLBACK_COLOR_TOKENS.some((token) => token.startsWith('blue-'))).toBe(true);
    expect(AVATAR_FALLBACK_COLOR_TOKENS.some((token) => token.startsWith('green-'))).toBe(true);
    expect(AVATAR_FALLBACK_COLOR_TOKENS.some((token) => token.startsWith('purple-'))).toBe(true);
  });

  it('passes the sanitized seed and stored pixel variant to Boring Avatars', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const rawSeed = 'npub 123/#?';
    const sanitizedSeed = sanitizeAvatarFallbackSeed(rawSeed);
    const themeColors = AVATAR_FALLBACK_COLOR_TOKENS.map((token) => `theme-${token}`);

    act(() => {
      renderer = TestRenderer.create(
        <Avatar state="fallback" seed={rawSeed} alt="Unsafe avatar seed" size={40} />
      );
    });

    const boringAvatar = renderer!.root.findByProps({ testID: 'boring-avatar' });

    expect(boringAvatar.props.name).toBe(sanitizedSeed);
    expect(boringAvatar.props.variant).toBe('pixel');
    expect(boringAvatar.props.size).toBe(40);
    expect(boringAvatar.props.colors).toEqual(
      getAvatarFallbackColorsForVariant({
        variant: 'pixel',
        colors: themeColors,
        seed: sanitizedSeed,
      })
    );

    act(() => {
      renderer.unmount();
    });
  });

  it('limits the pixel variation to a deterministic smaller palette', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const rawSeed = 'npub pixel palette/#?';
    const sanitizedSeed = sanitizeAvatarFallbackSeed(rawSeed);
    const themeColors = AVATAR_FALLBACK_COLOR_TOKENS.map((token) => `theme-${token}`);

    act(() => {
      renderer = TestRenderer.create(
        <Avatar
          state="fallback"
          seed={rawSeed}
          alt="Pixel avatar seed"
          size={40}
          fallbackVariant="pixel"
        />
      );
    });

    const boringAvatar = renderer!.root.findByProps({ testID: 'boring-avatar' });

    expect(boringAvatar.props.name).toBe(sanitizedSeed);
    expect(boringAvatar.props.variant).toBe('pixel');
    expect(boringAvatar.props.colors).toHaveLength(3);
    expect(boringAvatar.props.colors).toEqual(
      getAvatarFallbackColorsForVariant({
        variant: 'pixel',
        colors: themeColors,
        seed: sanitizedSeed,
      })
    );
    expect(boringAvatar.props.colors.every((color: string) => themeColors.includes(color))).toBe(
      true
    );

    act(() => {
      renderer.unmount();
    });
  });

  it('renders the beam variation as a white face with black face details', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <Avatar
          state="fallback"
          seed="npub 123/#?"
          alt="White face avatar seed"
          size={40}
          fallbackVariant="beam"
        />
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'boring-avatar' })).toHaveLength(0);

    const background = renderer!.root.findByProps({ testID: 'white-face-beam-background' });
    const head = renderer!.root.findByProps({ testID: 'white-face-beam-head' });
    const mouth = renderer!.root.findByProps({ testID: 'white-face-beam-mouth' });
    const leftEye = renderer!.root.findByProps({ testID: 'white-face-beam-left-eye' });
    const rightEye = renderer!.root.findByProps({ testID: 'white-face-beam-right-eye' });

    expect(background.props.fill).toMatch(
      /^theme-(blue|green|purple|yellow|orange|red)-(300|400)$/
    );
    expect(head.props.fill).toBe('white');
    expect([mouth.props.fill, mouth.props.stroke]).toContain('black');
    expect(leftEye.props.fill).toBe('black');
    expect(rightEye.props.fill).toBe('black');

    act(() => {
      renderer.unmount();
    });
  });

  it('renders the glass variation with the old seeded gradient fallback', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <Avatar
          state="fallback"
          seed="npub glass/#?"
          alt="Glass avatar seed"
          size={40}
          fallbackVariant="glass"
        />
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'boring-avatar' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: 'white-face-beam-head' })).toHaveLength(0);

    const primaryGradient = renderer!.root.findByProps({
      testID: 'avatar-glass-gradient-primary',
    });
    const overlayGradient = renderer!.root.findByProps({
      testID: 'avatar-glass-gradient-overlay',
    });

    expect(primaryGradient.props.colors).toHaveLength(3);
    expect(overlayGradient.props.colors).toHaveLength(3);

    act(() => {
      renderer.unmount();
    });
  });
});
