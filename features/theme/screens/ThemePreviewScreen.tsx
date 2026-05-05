/**
 * Theme Preview — entry modal for theme customisation.
 *
 * Horizontally-scrollable carousel of unit cards, one per wallet unit
 * (Bitcoin / USD / EUR / GBP). Each card shows that unit's draft wallpaper
 * and tapping it opens the Background modal scoped to that unit. Footer
 * Theme action opens the Gallery. When the draft is dirty, Apply / Cancel
 * appear at the bottom and a reset button appears in the header.
 */

import React, { useCallback, useEffect } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { PressableFeedback } from 'heroui-native';
import Icon from 'assets/icons';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger, log } from '@/shared/lib/logger';
import { UnitPreviewCard } from '@/features/theme/components/UnitPreviewCard';
import { useThemeDraft } from '@/features/theme/lib/themeDraft';
import { useAlbumList } from '@/features/theme/lib/useAlbumList';

// Preview unit list — broader than the wallet's live ACCOUNTS so users can
// theme units that don't exist yet.
interface PreviewUnit {
  id: string;
  label: string;
  sublabel: string;
}

const PREVIEW_UNITS: PreviewUnit[] = [
  { id: 'sat', label: 'Bitcoin', sublabel: 'SATS' },
  { id: 'usd', label: 'Personal', sublabel: 'USD' },
  { id: 'eur', label: 'Personal', sublabel: 'EUR' },
  { id: 'gbp', label: 'Personal', sublabel: 'GBP' },
];

const UNIT_IDS = PREVIEW_UNITS.map((u) => u.id);

// Tighter card so the footer Theme button sits above the fold on standard
// phone heights without scrolling.
const CARD_RATIO = 1.82;
const CARD_GUTTER = 12;
const CARD_MAX_WIDTH = 200;
const CARD_SCREEN_RATIO = 0.56;

interface UnitPreviewSlotProps {
  unit: PreviewUnit;
  width: number;
  height: number;
  onPress: (unitId: string) => void;
}

// Subscribes per-unit so editing one unit's wallpaper only re-renders that
// card, not the parent screen or its siblings. `resolveUnitTheme` returns
// a primitive ThemeName, so Zustand only triggers a render when this
// specific unit's resolved theme actually changes.
function UnitPreviewSlot({ unit, width, height, onPress }: UnitPreviewSlotProps) {
  const theme = useThemeDraft((s) => s.resolveUnitTheme(unit.id));
  return (
    <UnitPreviewCard
      themeName={theme}
      label={unit.label}
      sublabel={unit.sublabel}
      width={width}
      height={height}
      onPress={() => onPress(unit.id)}
      testID={`unit-card-${unit.id}`}
    />
  );
}

export function ThemePreviewScreen() {
  useLifecycleLogger('ThemePreviewScreen');

  const { width: screenWidth } = useWindowDimensions();
  const foreground = useThemeColor('foreground');
  const muted = useThemeColor('muted');

  const cardWidth = Math.min(CARD_MAX_WIDTH, screenWidth * CARD_SCREEN_RATIO);
  const cardHeight = cardWidth * CARD_RATIO;

  const draftActive = useThemeDraft((s) => s.active);
  const activeAlbumSlug = useThemeDraft((s) => s.activeAlbumSlug);
  const beginDraft = useThemeDraft((s) => s.beginDraft);
  const discard = useThemeDraft((s) => s.discard);
  const commit = useThemeDraft((s) => s.commit);
  // Invoking the action inside the selector returns a primitive boolean —
  // re-renders only fire when the dirty status actually flips, regardless
  // of how many fields shift inside the draft or store underneath. Per-unit
  // wallpaper subscriptions live on each `<UnitPreviewSlot>`, so the screen
  // body itself does not re-render on individual unit edits.
  const isDirty = useThemeDraft((s) => s.isDirty());

  const { getAlbum } = useAlbumList();
  const album = activeAlbumSlug ? getAlbum(activeAlbumSlug) : undefined;

  useEffect(() => {
    if (!draftActive) beginDraft(UNIT_IDS);
  }, [draftActive, beginDraft]);

  const handleCancel = useCallback(async () => {
    log.info('theme.preview.cancel');
    discard();
    router.back();
  }, [discard]);

  const handleApply = useCallback(async () => {
    log.info('theme.preview.apply', { albumSlug: activeAlbumSlug });
    await commit();
    router.back();
  }, [commit, activeAlbumSlug]);

  const handleUnitPress = useCallback((unitId: string) => {
    router.push({
      pathname: '/(theme-flow)/background',
      params: { unitId },
    });
  }, []);

  const cards = PREVIEW_UNITS.map((unit) => (
    <UnitPreviewSlot
      key={unit.id}
      unit={unit}
      width={cardWidth}
      height={cardHeight}
      onPress={handleUnitPress}
    />
  ));

  return (
    <>
      <Stack.Screen options={{ title: 'Theme preview' }} />
      <Screen
        name="ThemePreviewScreen"
        contentPadding={0}
        footer={
          isDirty ? (
            <BottomButtons>
              <ButtonHandler
                buttons={[
                  {
                    text: 'Cancel',
                    variant: 'secondary',
                    testID: 'theme-cancel',
                    onPress: handleCancel,
                  },
                  {
                    text: 'Apply',
                    variant: 'primary',
                    testID: 'theme-apply',
                    onPress: handleApply,
                  },
                ]}
              />
            </BottomButtons>
          ) : null
        }>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + CARD_GUTTER}
          decelerationRate="fast"
          contentContainerStyle={{
            paddingHorizontal: (screenWidth - cardWidth) / 2,
            gap: CARD_GUTTER,
            paddingVertical: 16,
          }}>
          {cards}
        </ScrollView>

        <Text
          size={14}
          medium
          className="mb-4 mt-1 text-center"
          style={{ color: album ? foreground : 'transparent' }}>
          {album?.displayName ?? '—'}
        </Text>

        <View className="mt-1 flex-row items-center justify-center gap-12">
          <PressableFeedback
            onPress={() => router.push('/(theme-flow)/gallery')}
            animation={false}
            testID="theme-preview-theme-button">
            <PressableFeedback.Scale>
              <VStack align="center" spacing={6}>
                <View
                  className="h-12 w-12 items-center justify-center rounded-3xl"
                  style={{ backgroundColor: muted }}>
                  <Icon name="mdi:palette" size={22} color={foreground} />
                </View>
                <Text size={12} medium style={{ color: foreground }}>
                  Theme
                </Text>
              </VStack>
            </PressableFeedback.Scale>
          </PressableFeedback>
        </View>
      </Screen>
    </>
  );
}
