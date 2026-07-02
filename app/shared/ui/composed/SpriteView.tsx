import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { View } from '@/shared/ui/primitives/View/View';
import { Image } from '@/shared/ui/primitives/Image';
import { backgroundImageThemes } from 'config/backgroundImageThemes';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { Log, log } from '@/shared/lib/logger';

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
   * false — each enabled instance streams DeviceMotion at 50ms and runs
   * springs, a real per-instance CPU cost.
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

function describeImageLoadError(event: unknown): string {
  if (event && typeof event === 'object') {
    const directError = (event as { error?: unknown }).error;
    if (typeof directError === 'string') return directError;
    const nativeEvent = (event as { nativeEvent?: { error?: unknown } }).nativeEvent;
    if (typeof nativeEvent?.error === 'string') return nativeEvent.error;
  }
  return String(event ?? 'unknown');
}

const AnimatedSpriteBackground = React.memo(function AnimatedSpriteBackground({
  backgroundColor,
  themeName,
  motionEnabled = true,
  imageTransitionMs,
}: AnimatedSpriteBackgroundProps) {
  const motion = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const ctxTheme = useTheme();
  const activeTheme = themeName ?? ctxTheme.currentTheme;
  const backgroundImageSource = backgroundImageThemes[activeTheme];
  const hasImage = !!backgroundImageSource;

  // Perf counters: how often this (notoriously re-render-prone) background
  // re-renders, and how long the wallpaper takes to decode. Surfaced so a
  // custom-wallpaper perf regression is visible in `bg.sprite.*` logs.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const loadStartRef = useRef(0);
  useEffect(() => {
    loadStartRef.current = Date.now();
  }, [backgroundImageSource]);

  // Parallax motion — only subscribe when an image is actually shown. A
  // solid-colour theme has no visible parallax, so streaming the device-motion
  // sensor at 50ms (a real CPU cost on every screen) would be pure waste.
  useEffect(() => {
    if (!hasImage || !motionEnabled) return;
    DeviceMotion.setUpdateInterval(50);
    log.debug('bg.sprite.motion.start', { intervalMs: 50 });
    const subscription = DeviceMotion.addListener(({ rotation }) => {
      if (rotation) {
        const { beta = 0, gamma = 0 } = rotation;
        Animated.spring(motion, {
          toValue: {
            x: gamma * 10,
            y: beta * 10,
          },
          useNativeDriver: true,
          bounciness: 100,
          speed: 200,
        }).start();
      }
    });
    return () => {
      log.debug('bg.sprite.motion.stop');
      subscription.remove();
    };
  }, [motion, hasImage, motionEnabled]);

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

  if (!backgroundImageSource) {
    log.debug('bg.sprite.render', {
      theme: activeTheme,
      hasImage: false,
      renderCount: renderCountRef.current,
    });
    return (
      <Log name="SpriteView">
        <View style={[StyleSheet.absoluteFill, { backgroundColor }]}></View>
      </Log>
    );
  }

  log.debug('bg.sprite.render', {
    theme: activeTheme,
    hasImage: true,
    renderCount: renderCountRef.current,
  });

  return (
    <Log name="SpriteView">
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: motion.getTranslateTransform(),
          },
        ]}>
        <Image
          source={backgroundImageSource}
          // Decode capped at the view's size (full-screen), never the asset's
          // native resolution — explicit so a primitive-default change can't
          // silently start decoding 4K wallpapers.
          allowDownscaling
          {...(imageTransitionMs !== undefined ? { transition: imageTransitionMs } : {})}
          style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.18 }] }]}
          onLoad={() => {
            log.info('bg.sprite.image_loaded', {
              theme: activeTheme,
              decodeMs: loadStartRef.current ? Date.now() - loadStartRef.current : null,
              renderCount: renderCountRef.current,
              ...describeImageSource(backgroundImageSource),
            });
          }}
          onError={(event) => {
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
