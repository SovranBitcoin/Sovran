/* eslint-disable no-restricted-syntax -- [DEBUG-inv] tile colors are fixed
 * screenshot targets for the pixel-count loop; they must NOT follow the theme. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { Button, Card } from 'heroui-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import {
  FADE_STRESS_CYCLE_MS,
  FADE_STRESS_TILE_COUNT,
  FADE_STRESS_TILE_VARIANTS,
  FadeStressTile,
} from '@/features/settings/design-system/fadeRevealStress';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
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

const FADE_REVEAL_STRESS_FAMILY = getDesignSystemFamily('fade-reveal-stress');

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
    if (tally.reported === FADE_STRESS_TILE_COUNT) {
      log[tally.stuck > 0 ? 'warn' : 'info']('visual.fadeprobe.cycle', {
        cycle: tally.cycle,
        tiles: FADE_STRESS_TILE_COUNT,
        stuck: tally.stuck,
      });
      setTotals((prev) => ({
        mounted: prev.mounted + FADE_STRESS_TILE_COUNT,
        stuck: prev.stuck + tally.stuck,
      }));
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const interval = setInterval(() => {
      setCycle((c) => {
        cycleTally.current = { cycle: c + 1, reported: 0, stuck: 0 };
        return c + 1;
      });
    }, FADE_STRESS_CYCLE_MS);
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
            {Array.from({ length: FADE_STRESS_TILE_COUNT }, (_, i) => (
              <FadeStressTile
                key={i}
                index={i}
                variant={FADE_STRESS_TILE_VARIANTS[i % FADE_STRESS_TILE_VARIANTS.length]}
                size={tileSize}
                onResult={handleResult}
              />
            ))}
          </View>

          {FADE_REVEAL_STRESS_FAMILY.scenarios.map((scenario) => (
            <Section key={scenario.id} title={scenario.title}>
              <View testID={`design-system-scenario-fade-reveal-stress-${scenario.id}`}>
                {scenario.render()}
              </View>
            </Section>
          ))}
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
});
