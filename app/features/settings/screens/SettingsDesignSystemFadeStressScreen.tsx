/* eslint-disable no-restricted-syntax -- [DEBUG-inv] tile colors are fixed
 * screenshot targets for the pixel-count loop; they must NOT follow the theme. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Button, Card } from 'heroui-native';

import { CurrencyIcon } from 'assets/icons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFadeRevealProbe } from '@/shared/lib/debug/fadeRevealProbe';
import { log } from '@/shared/lib/logger';

/**
 * [DEBUG-inv] Fade-reveal stress harness.
 *
 * Reproduces, at volume, the exact shared-value fade-in idioms behind the
 * intermittently-invisible elements (profile pfp, top-followers grid, feed
 * cards, wallet QR button): `opacity: useSharedValue(0)` driven to 1 by
 * `withTiming`/`withDelay` inside a mount effect. Every cycle remounts the
 * whole grid, so each tile re-runs the race.
 *
 * Two failure classes, two signals:
 *  - value never reaches 1  → tile turns RED + `visual.fadeprobe.cycle`
 *    logs stuck > 0 (reanimated update-flush race — JS-observable).
 *  - value reaches 1 but the tile is BLANK on screen → paint-level failure;
 *    only a screenshot catches it. Tiles are solid bright squares on a dark
 *    field so a pixel count of the grid area gives ground truth.
 */

const TILE_VARIANTS = ['plain', 'scale', 'delayed', 'quick', 'svg'] as const;
type TileVariant = (typeof TILE_VARIANTS)[number];

const TILES = 45;
const CYCLE_MS = 2000;
/** Latest reveal: withDelay caps at 300ms + 350ms timing → 650ms; probe well past it. */
const PROBE_DEADLINE_MS = 1200;

function StressTile({
  index,
  variant,
  size,
  onResult,
}: {
  index: number;
  variant: TileVariant;
  size: number;
  onResult: (stuck: boolean) => void;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    switch (variant) {
      case 'plain':
        // top-followers idiom (UserProfileScreen:350)
        progress.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
        break;
      case 'scale':
        // avatar idiom (UserProfileScreen:536)
        progress.set(withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
        break;
      case 'delayed':
        // feed-card idiom (UserFeed:176)
        progress.set(
          withDelay(
            Math.min(index * 20, 300),
            withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) })
          )
        );
        break;
      case 'quick':
        // QR-button idiom (QRButton.ios:103)
        progress.set(withTiming(1, { duration: 180 }));
        break;
      case 'svg':
        // fade + react-native-svg child (swapped-Svg repaint hazard)
        progress.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
        break;
    }
  }, [progress, variant, index]);

  // A stuck tile is repainted solid red by a state flip so it is visible even
  // though its animated opacity is 0 — the red square is the loop "going red".
  const [flaggedStuck, setFlaggedStuck] = useState(false);
  useFadeRevealProbe(`stress:${variant}:${index}`, progress, {
    deadlineMs: PROBE_DEADLINE_MS,
    onResult: useCallback(
      (stuck: boolean) => {
        setFlaggedStuck(stuck);
        onResult(stuck);
      },
      [onResult]
    ),
  });

  const animStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [
        ...(variant === 'scale' ? [{ scale: p }] : []),
        ...(variant === 'delayed' ? [{ translateY: (1 - p) * 12 }] : []),
      ],
    };
  });

  if (flaggedStuck) {
    return (
      <View style={[styles.tile, { width: size, height: size, backgroundColor: '#ff2d2d' }]} />
    );
  }

  return (
    <Animated.View
      style={[
        styles.tile,
        { width: size, height: size, backgroundColor: variantColor(variant) },
        animStyle,
      ]}>
      {variant === 'svg' ? <CurrencyIcon width={size * 0.6} currency="sat" /> : null}
    </Animated.View>
  );
}

function variantColor(variant: TileVariant): string {
  switch (variant) {
    case 'plain':
      return '#31d0aa';
    case 'scale':
      return '#4f9cf9';
    case 'delayed':
      return '#f9a94f';
    case 'quick':
      return '#c56bf0';
    case 'svg':
      return '#e05c8a';
  }
}

export function SettingsDesignSystemFadeStressScreen() {
  const { width: screenWidth } = useWindowDimensions();
  const foreground = useThemeColor('foreground');

  const [auto, setAuto] = useState(true);
  const [jank, setJank] = useState(false);
  const [cycle, setCycle] = useState(1);
  const [totals, setTotals] = useState({ mounted: 0, stuck: 0 });

  // [DEBUG-inv] mimic real screen-mount conditions: stall the JS thread in
  // bursts across the reveal window (a profile mount runs fetch/parse work
  // while its fade-in is supposed to start). Widens the race window the
  // settled stress grid doesn't naturally have.
  useEffect(() => {
    if (!jank) return;
    const stalls = [0, 150, 380].map((delay) =>
      setTimeout(() => {
        const until = Date.now() + 160;
        while (Date.now() < until) {
          // busy-wait: deliberate JS-thread stall
        }
      }, delay)
    );
    return () => stalls.forEach(clearTimeout);
  }, [jank, cycle]);

  // Per-cycle tally, flushed into totals + one summary log line when the
  // last tile of the cycle reports.
  const cycleTally = useRef({ cycle: 1, reported: 0, stuck: 0 });

  const handleResult = useCallback((stuck: boolean) => {
    const tally = cycleTally.current;
    tally.reported += 1;
    if (stuck) tally.stuck += 1;
    if (tally.reported === TILES) {
      log[tally.stuck > 0 ? 'warn' : 'info']('visual.fadeprobe.cycle', {
        cycle: tally.cycle,
        tiles: TILES,
        stuck: tally.stuck,
      });
      setTotals((prev) => ({ mounted: prev.mounted + TILES, stuck: prev.stuck + tally.stuck }));
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const interval = setInterval(() => {
      setCycle((c) => {
        cycleTally.current = { cycle: c + 1, reported: 0, stuck: 0 };
        return c + 1;
      });
    }, CYCLE_MS);
    return () => clearInterval(interval);
  }, [auto]);

  const COLUMNS = 5;
  const GRID_PADDING = 16;
  const GRID_GAP = 8;
  const tileSize = (screenWidth - GRID_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <ScreenWrapper name="SettingsDesignSystemFadeStressScreen" scroll="custom" safeArea>
      <ScrollView contentContainerStyle={styles.scroll}>
        <VStack spacing={12}>
          <Card variant="secondary" style={styles.statsCard}>
            <HStack justify="space-between" align="center">
              <VStack spacing={2}>
                <Text size={13} color={foreground} testID="fade-stress-stats">
                  cycle {cycle} · mounted {totals.mounted} · stuck {totals.stuck}
                </Text>
                <Text size={11}>
                  red tile = opacity never flushed · blank tile at stuck 0 = paint bug
                </Text>
              </VStack>
              <VStack spacing={6}>
                <Button size="sm" variant="secondary" onPress={() => setAuto((a) => !a)}>
                  <Button.Label>{auto ? 'Pause' : 'Run'}</Button.Label>
                </Button>
                <Button size="sm" variant="secondary" onPress={() => setJank((j) => !j)}>
                  <Button.Label>{jank ? 'Jank: on' : 'Jank: off'}</Button.Label>
                </Button>
              </VStack>
            </HStack>
          </Card>

          {/* key={cycle} remounts every tile — each cycle re-races mount-commit
              vs the reanimated update batch, exactly like navigating to the
              profile / wallet screens does. */}
          <View key={cycle} style={[styles.grid, { gap: GRID_GAP }]} testID="fade-stress-grid">
            {Array.from({ length: TILES }, (_, i) => (
              <StressTile
                key={i}
                index={i}
                variant={TILE_VARIANTS[i % TILE_VARIANTS.length]}
                size={tileSize}
                onResult={handleResult}
              />
            ))}
          </View>
        </VStack>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
  },
  statsCard: {
    padding: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#101014',
    borderRadius: 12,
    padding: 8,
  },
  tile: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
