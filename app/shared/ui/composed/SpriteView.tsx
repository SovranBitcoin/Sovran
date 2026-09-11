import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { retainWallpaperMotion, wallpaperMotion } from '@/shared/lib/theme/wallpaperMotion';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { noteWallpaperRendered } from '@/shared/lib/theme/themeTransition';
import { markWallpaperLoaded, markWallpaperFailed } from '@/shared/lib/theme/wallpaperRenderState';
import { View } from '@/shared/ui/primitives/View/View';
import { Image } from '@/shared/ui/primitives/Image';
import { backgroundImageThemes } from 'config/backgroundImageThemes';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { Log, log } from '@/shared/lib/logger';
import { describeImageLoadError } from '@/shared/lib/imageError';

interface AnimatedSpriteBackgroundProps {
  backgroundColor: string;
  /**
   * Theme to render. When omitted, falls back to the global theme context
   * (preserves behaviour of existing callsites that haven't migrated to
   * passing per-unit wallpapers explicitly).
   */
  themeName?: string;
  /**
   * Parallax motion. Pre-mounted hidden wallpaper layers (the account
   * carousel keeps every unit's wallpaper decoded at opacity 0) MUST pass
   * false — hidden instances must not keep the shared sensor subscription alive.
   */
  motionEnabled?: boolean;
  /**
   * expo-image source-change fade. The chrome background passes 0: its
   * crossfades are driven by layer opacity (drag/settle), and the default
   * 1s fade on top of that reads as a post-settle shimmer.
   */
  imageTransitionMs?: number;
}

function describeImageSource(source: unknown): Record<string, unknown> {
  if (typeof source === 'number') {
    return { sourceKind: 'bundled-require', assetId: source };
  }
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>;
    const uri = typeof record.uri === 'string' ? record.uri : undefined;
    if (uri) {
      return {
        sourceKind: uri.startsWith('file://')
          ? 'file-uri'
          : uri.startsWith('http://') || uri.startsWith('https://')
            ? 'remote-uri'
            : 'uri',
        uri,
      };
    }
    return { sourceKind: 'object', sourceKeys: Object.keys(record) };
  }
  return { sourceKind: typeof source };
}

/**
 * Wallpaper render quality: the image is laid out at this fraction of the
 * screen and GPU-upscaled to cover it, so expo-image DECODES at the reduced
 * resolution (decode follows layout size with allowDownscaling). 0.7 cuts
 * decoded-bitmap memory roughly in half per layer (the account carousel
 * pre-mounts several) and is visually imperceptible under the 1.18 parallax
 * overscan. Raise toward 1 if a wallpaper ever looks soft.
 */
const WALLPAPER_RENDER_SCALE = 0.7;
const PARALLAX_OVERSCAN = 1.18;

const AnimatedSpriteBackground = React.memo(function AnimatedSpriteBackground({
  backgroundColor,
  themeName,
  motionEnabled = true,
  imageTransitionMs,
}: AnimatedSpriteBackgroundProps) {
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const ctxTheme = useTheme();
  const activeTheme = themeName ?? ctxTheme.currentTheme;
  const backgroundImageSource = backgroundImageThemes[activeTheme];
  const hasImage = !!backgroundImageSource;

  // Perf counters: how often this (notoriously re-render-prone) background
  // re-renders, and how long the wallpaper takes to decode. Surfaced so a
  // custom-wallpaper perf regression is visible in `bg.sprite.*` logs.
  // Counted and logged from an effect, not the render body. Incrementing a ref
  // and calling `log.debug` during render are both side effects in render — the
  // second is a React rule violation on its own, and together they made the
  // React Compiler skip this component, so the counter was suppressing the
  // memoization whose absence it exists to report. Post-commit counting also
  // measures committed renders rather than discarded attempts, which is the
  // number a wallpaper perf regression actually shows up in.
  const renderCountRef = useRef(0);
  const loadStartRef = useRef(0);
  useEffect(() => {
    loadStartRef.current = Date.now();
  }, [backgroundImageSource]);

  // Parallax: ALL instances read the SHARED wallpaperMotion value (so
  // pre-mounted carousel layers stay pixel-aligned with the base layer);
  // motionEnabled only controls whether THIS instance keeps the shared
  // DeviceMotion subscription alive (hidden layers don't).
  useVisualActivityEffect(retainWallpaperMotion, hasImage && motionEnabled && !reducedMotion);

  useEffect(() => {
    if (!backgroundImageSource) {
      const registeredThemes = Object.keys(backgroundImageThemes);
      log.warn('bg.sprite.image_missing', {
        theme: activeTheme,
        requestedTheme: themeName ?? null,
        currentTheme: ctxTheme.currentTheme,
        backgroundColor,
        registeredImageThemeCount: registeredThemes.length,
        registeredImageThemeSamples: registeredThemes.slice(0, 12),
      });
      return;
    }

    log.info('bg.sprite.image_source', {
      theme: activeTheme,
      requestedTheme: themeName ?? null,
      currentTheme: ctxTheme.currentTheme,
      ...describeImageSource(backgroundImageSource),
    });
  }, [activeTheme, backgroundColor, backgroundImageSource, ctxTheme.currentTheme, themeName]);

  useEffect(() => {
    renderCountRef.current += 1;
    log.debug('bg.sprite.render', {
      theme: activeTheme,
      hasImage: !!backgroundImageSource,
      renderCount: renderCountRef.current,
    });
  });

  if (!backgroundImageSource) {
    return (
      <Log name="SpriteView">
        <View style={[StyleSheet.absoluteFill, { backgroundColor }]}></View>
      </Log>
    );
  }

  return (
    <Log name="SpriteView">
      {/* Solid own-surface underlay: keeps the layer fully opaque before the
          image decodes and under parallax translation, so a fading layer
          never lets the backdrop bleed through. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor }]} />
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: wallpaperMotion.getTranslateTransform(),
          },
        ]}>
        <Image
          source={backgroundImageSource}
          // Decode capped at the view's LAYOUT size, never the asset's native
          // resolution — and the layout is deliberately sub-screen
          // (WALLPAPER_RENDER_SCALE), upscaled on the GPU to cover.
          allowDownscaling
          {...(imageTransitionMs !== undefined ? { transition: imageTransitionMs } : {})}
          style={[
            {
              position: 'absolute',
              width: window.width * WALLPAPER_RENDER_SCALE,
              height: window.height * WALLPAPER_RENDER_SCALE,
              left: (window.width * (1 - WALLPAPER_RENDER_SCALE)) / 2,
              top: (window.height * (1 - WALLPAPER_RENDER_SCALE)) / 2,
              transform: [{ scale: PARALLAX_OVERSCAN / WALLPAPER_RENDER_SCALE }],
            },
          ]}
          onLoad={() => {
            // Every sprite signals the transition seam when a theme's image
            // is rendered — the programmatic overlay holds until the layer
            // underneath reports its theme, then blends away seamlessly.
            noteWallpaperRendered(activeTheme);
            markWallpaperLoaded(activeTheme);
            log.info('bg.sprite.image_loaded', {
              theme: activeTheme,
              decodeMs: loadStartRef.current ? Date.now() - loadStartRef.current : null,
              renderCount: renderCountRef.current,
              ...describeImageSource(backgroundImageSource),
            });
          }}
          onError={(event) => {
            markWallpaperFailed(activeTheme);
            log.warn('bg.sprite.image_load_failed', {
              theme: activeTheme,
              error: describeImageLoadError(event),
              ...describeImageSource(backgroundImageSource),
            });
          }}
        />
      </Animated.View>
    </Log>
  );
});

export default AnimatedSpriteBackground;
