import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import Image from '@/shared/ui/primitives/Image';
import { router } from 'expo-router';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { THEMES } from '@/shared/providers/ThemeProvider';
import Icon from 'assets/icons';
import Container from '@/shared/ui/composed/Container';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  backgroundImageThemes,
  backgroundThemeDisplayNames,
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  BACKGROUND_THEME_NAMES,
} from 'config/backgroundImageThemes';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import opacity from 'hex-color-opacity';
import { PressableFeedback, SearchField } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';

const CARD_GAP = 12;
const HORIZONTAL_PADDING = 20;

// Base themes (non-background image themes)
const baseThemes = [
  'dark',
  'navy',
  'sunset',
  'beige',
  'crimson-night',
  'twilight-amber',
  'velvet-emerald',
];

// Display names for base themes
const baseThemeDisplayNames: Record<string, string> = {
  dark: 'Dark',
  navy: 'Navy',
  beige: 'Beige',
  sunset: 'Sunset',
  'crimson-night': 'Crimson Night',
  'twilight-amber': 'Twilight Amber',
  'velvet-emerald': 'Velvet Emerald',
};

// Shade order for palette display (dark to light)
const PALETTE_SHADES = ['950', '900', '800', '700', '600', '500', '400', '300', '200', '100', '50', '0'] as const;

// Look up display name dynamically (handles downloaded themes registered at runtime)
function getDisplayName(themeName: string): string {
  return baseThemeDisplayNames[themeName] || backgroundThemeDisplayNames[themeName] || themeName;
}

interface ThemeCardProps {
  themeName: string;
  isSelected: boolean;
  onPress: () => void;
  isBackgroundTheme: boolean;
  cardWidth: number;
}

const ThemeCard = React.memo(
  ({
    themeName,
    isSelected,
    onPress,
    isBackgroundTheme,
    cardWidth,
  }: ThemeCardProps) => {
    const displayName = getDisplayName(themeName);
    const themeColors = THEMES[themeName as keyof typeof THEMES] as Record<string, string> | undefined;
    const dominantColors = backgroundThemeDominantColors[themeName];
    const gradientColors = backgroundThemeGradientColors[themeName];

    const bgGradient = isBackgroundTheme
      ? gradientColors?.map((c) => c.hex) || ['#000', '#000', '#000']
      : null;

    // Circle size scales with card width
    const circleSize = Math.max(10, Math.floor((cardWidth - 24 - 5 * 3) / 6));
    const smallCircle = Math.max(8, circleSize - 2);

    return (
      <PressableFeedback
        onPress={onPress}
        animation={false}
        className="overflow-hidden rounded-2xl"
        style={{ width: cardWidth }}>
        <PressableFeedback.Scale className="w-full">
          <View
            className={isSelected ? 'border-muted border-2' : ''}
            style={[styles.cardInner, { width: cardWidth }]}>
            {/* Image / gradient preview */}
            <View style={{ width: cardWidth, height: cardWidth * 0.75, position: 'relative' }}>
              {isBackgroundTheme && backgroundImageThemes[themeName] ? (
                <Image
                  source={backgroundImageThemes[themeName]}
                  style={StyleSheet.absoluteFillObject}
                />
              ) : bgGradient ? (
                <LinearGradient
                  colors={bgGradient as [string, string, ...string[]]}
                  style={StyleSheet.absoluteFillObject}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              ) : themeColors ? (
                <LinearGradient
                  colors={[
                    themeColors['800'] || '#1a1a1a',
                    themeColors['900'] || '#0d0d0d',
                    themeColors['950'] || '#000000',
                  ]}
                  style={StyleSheet.absoluteFillObject}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1a1a1a' }]} />
              )}

              <PressableFeedback.Ripple
                animation={{
                  backgroundColor: { value: '#ffffff' },
                  opacity: { value: [0, 0.18, 0] },
                }}
              />

              {/* Name overlay */}
              {isBackgroundTheme ? (
                <MaskedView
                  style={styles.textOverlay}
                  maskElement={
                    <LinearGradient
                      colors={['transparent', 'black']}
                      locations={[0, 0.6]}
                      style={StyleSheet.absoluteFillObject}
                    />
                  }>
                  <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
                </MaskedView>
              ) : (
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.7)']}
                  style={styles.textOverlay}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                />
              )}

              <View style={styles.labelContainer}>
                <Text size={13} bold style={styles.themeName} numberOfLines={1}>
                  {displayName}
                </Text>
                {isSelected && (
                  <View style={styles.checkmark}>
                    <Icon name="mdi:check-circle" size={14} color="#fff" />
                  </View>
                )}
              </View>
            </View>

            {/* Color palette section */}
            <View style={styles.colorSection}>
              {/* Full 12-shade palette in 2 rows */}
              {themeColors && (
                <>
                  <View style={styles.colorRow}>
                    {PALETTE_SHADES.slice(0, 6).map((shade) => (
                      <View
                        key={shade}
                        style={[
                          styles.colorDot,
                          { width: circleSize, height: circleSize, borderRadius: circleSize / 2, backgroundColor: themeColors[shade] || '#333' },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.colorRow}>
                    {PALETTE_SHADES.slice(6).map((shade) => (
                      <View
                        key={shade}
                        style={[
                          styles.colorDot,
                          { width: circleSize, height: circleSize, borderRadius: circleSize / 2, backgroundColor: themeColors[shade] || '#333' },
                        ]}
                      />
                    ))}
                  </View>
                </>
              )}

              {/* Dominant colors (wallpaper themes) */}
              {isBackgroundTheme && dominantColors && dominantColors.length > 0 && (
                <View style={styles.colorRow}>
                  {dominantColors.map((c, i) => (
                    <View
                      key={`d${i}`}
                      style={[
                        styles.colorDot,
                        { width: smallCircle, height: smallCircle, borderRadius: smallCircle / 2, backgroundColor: c.hex },
                      ]}
                    />
                  ))}
                </View>
              )}

              {/* Gradient colors (wallpaper themes) */}
              {isBackgroundTheme && gradientColors && gradientColors.length > 0 && (
                <View style={styles.colorRow}>
                  {gradientColors.map((c, i) => (
                    <View
                      key={`g${i}`}
                      style={[
                        styles.colorDot,
                        { width: smallCircle, height: smallCircle, borderRadius: smallCircle / 2, backgroundColor: c.hex },
                      ]}
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        </PressableFeedback.Scale>
      </PressableFeedback>
    );
  }
);

ThemeCard.displayName = 'ThemeCard';

export function SettingsThemeScreen() {
  useLifecycleLogger('SettingsThemeScreen');

  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [searchText, setSearchText] = useState('');
  const currentTheme = useSettingsStore((state) => state.getTheme());
  const setTheme = useSettingsStore((state) => state.setTheme);

  const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP) / 2;

  const handleThemePress = useCallback(
    (themeName: string) => {
      log.info('settings.theme.change', { from: currentTheme, to: themeName });
      setTheme(themeName);
      router.back();
    },
    [setTheme, currentTheme]
  );

  // Filter themes based on search
  const filteredBaseThemes = useMemo(
    () =>
      baseThemes.filter((theme) => {
        const name = getDisplayName(theme);
        return (
          name.toLowerCase().includes(searchText.toLowerCase()) ||
          theme.toLowerCase().includes(searchText.toLowerCase())
        );
      }),
    [searchText]
  );

  const filteredBackgroundThemes = useMemo(
    () =>
      BACKGROUND_THEME_NAMES.filter((theme) => {
        const name = getDisplayName(theme);
        return (
          name.toLowerCase().includes(searchText.toLowerCase()) ||
          theme.toLowerCase().includes(searchText.toLowerCase())
        );
      }),
    [searchText]
  );

  const renderThemeGrid = useCallback(
    (themes: string[], isBackgroundTheme: boolean) => {
      const rows: string[][] = [];
      for (let i = 0; i < themes.length; i += 2) {
        rows.push(themes.slice(i, i + 2));
      }

      return rows.map((row, rowIndex) => (
        <HStack key={`row-${rowIndex}`} spacing={CARD_GAP} style={[styles.row, { alignItems: 'flex-start' }]}>
          {row.map((themeName) => (
            <ThemeCard
              key={themeName}
              themeName={themeName}
              isSelected={currentTheme === themeName}
              onPress={() => handleThemePress(themeName)}
              isBackgroundTheme={isBackgroundTheme}
              cardWidth={cardWidth}
            />
          ))}
          {row.length === 1 && <View style={{ width: cardWidth }} />}
        </HStack>
      ));
    },
    [currentTheme, handleThemePress, cardWidth]
  );

  const hasResults = filteredBaseThemes.length > 0 || filteredBackgroundThemes.length > 0;

  if (searchText && !hasResults) {
    log.debug('settings.theme.search.no_results', { query: searchText });
  }

  return (
    <Container>
      <Screen name="SettingsThemeScreen">
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}>
          {/* Search */}
          <View style={styles.searchContainer}>
            <SearchField value={searchText} onChange={setSearchText}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search themes..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </View>

          {!hasResults && (
            <VStack style={styles.emptyState} spacing={8}>
              <Icon name="mingcute:search-3-line" size={48} color={opacity(foreground, 0.33)} />
              <Text size={16} style={{ color: opacity(foreground, 0.4) }}>
                No themes found
              </Text>
            </VStack>
          )}

          {/* Background Image Themes */}
          {filteredBackgroundThemes.length > 0 && (
            <View style={styles.section}>
              <Text
                size={13}
                medium
                style={[styles.sectionTitle, { color: opacity(foreground, 0.5) }]}>
                WALLPAPERS
              </Text>
              <Spacer size={12} />
              {renderThemeGrid(filteredBackgroundThemes, true)}
            </View>
          )}

          {/* Color Themes */}
          {filteredBaseThemes.length > 0 && (
            <View style={styles.section}>
              <Text
                size={13}
                medium
                style={[styles.sectionTitle, { color: opacity(foreground, 0.5) }]}>
                COLOR THEMES
              </Text>
              <Spacer size={12} />
              {renderThemeGrid(filteredBaseThemes, false)}
            </View>
          )}
        </ScrollView>
      </Screen>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  searchContainer: {
    marginBottom: 24,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    letterSpacing: 1.5,
    marginLeft: 4,
  },
  row: {
    marginBottom: CARD_GAP,
  },
  cardInner: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  textOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 50,
  },
  labelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeName: {
    color: '#fff',
    flex: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  checkmark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSection: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 4,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 3,
    flexWrap: 'wrap',
  },
  colorDot: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});
