import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import Image from 'components/ui/Image';
import { router } from 'expo-router';
import { useSettingsStore } from 'stores/settingsStore';
import { THEMES } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  backgroundImageThemes,
  backgroundThemeDisplayNames,
  BACKGROUND_THEME_NAMES,
  backgroundThemeGradientColors,
} from 'config/backgroundImageThemes';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import opacity from 'hex-color-opacity';
import { PressableFeedback, SearchField } from 'heroui-native';
import { useThemeColor } from '@/hooks/useThemeColor';

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

// Combined display names (base + background themes from config)
const themeNameMap: Record<string, string> = {
  ...baseThemeDisplayNames,
  ...backgroundThemeDisplayNames,
};

interface ThemeCardProps {
  themeName: string;
  isSelected: boolean;
  onPress: () => void;
  isBackgroundTheme: boolean;
  cardWidth: number;
  cardHeight: number;
}

const ThemeCard = React.memo(
  ({
    themeName,
    isSelected,
    onPress,
    isBackgroundTheme,
    cardWidth,
    cardHeight,
  }: ThemeCardProps) => {
    const displayName = themeNameMap[themeName] || themeName;

    // Get colors for this specific theme
    const themeColors = THEMES[themeName as keyof typeof THEMES];

    // Get gradient colors for background themes
    const gradientColors = isBackgroundTheme
      ? backgroundThemeGradientColors[themeName]?.map((c) => c.hex) || ['#000', '#000', '#000']
      : null;

    return (
      <PressableFeedback
        onPress={onPress}
        animation={false}
        className="overflow-hidden rounded-2xl"
        style={{ width: cardWidth, height: cardHeight }}>
        <PressableFeedback.Scale className="h-full w-full">
          <View
            className={isSelected ? 'border-muted border-2' : ''}
            style={[styles.cardInner, { width: cardWidth, height: cardHeight }]}>
            {/* Background */}
            {isBackgroundTheme && backgroundImageThemes[themeName] ? (
              <Image
                source={backgroundImageThemes[themeName]}
                style={StyleSheet.absoluteFillObject}
              />
            ) : gradientColors ? (
              <LinearGradient
                colors={gradientColors as [string, string, ...string[]]}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
            ) : themeColors ? (
              <LinearGradient
                colors={[
                  (themeColors as Record<string, string>)['800'] || '#1a1a1a',
                  (themeColors as Record<string, string>)['900'] || '#0d0d0d',
                  (themeColors as Record<string, string>)['950'] || '#000000',
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

            {/* Color palette preview for base themes */}
            {!isBackgroundTheme && themeColors && (
              <View style={styles.paletteContainer}>
                <HStack spacing={4}>
                  {['400', '500', '600', '700'].map((shade) => (
                    <View
                      key={shade}
                      style={[
                        styles.paletteCircle,
                        {
                          backgroundColor: (themeColors as Record<string, string>)[shade] || '#333',
                        },
                      ]}
                    />
                  ))}
                </HStack>
              </View>
            )}

            {/* Gradient colors for wallpaper themes */}
            {isBackgroundTheme && backgroundThemeGradientColors[themeName] && (
              <View style={styles.paletteContainer}>
                <HStack spacing={4}>
                  {backgroundThemeGradientColors[themeName].map((color, index) => (
                    <View
                      key={index}
                      style={[styles.paletteCircle, { backgroundColor: color.hex }]}
                    />
                  ))}
                </HStack>
              </View>
            )}

            {/* Overlay for text readability - gradient blur for wallpapers, simple gradient for color themes */}
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

            {/* Theme name */}
            <View style={styles.labelContainer}>
              <Text size={14} bold overpass style={styles.themeName} numberOfLines={1}>
                {displayName}
              </Text>
              {isSelected && (
                <View style={styles.checkmark}>
                  <Icon name="mdi:check-circle" size={14} color="#fff" />
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

function ThemeSettings() {
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [searchText, setSearchText] = useState('');
  const currentTheme = useSettingsStore((state) => state.getTheme());
  const setTheme = useSettingsStore((state) => state.setTheme);

  // Calculate card dimensions based on screen width
  const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP) / 2;
  const cardHeight = cardWidth * 1.2;

  const handleThemePress = useCallback(
    (themeName: string) => {
      setTheme(themeName);
      router.back();
    },
    [setTheme]
  );

  // Filter themes based on search
  const filteredBaseThemes = useMemo(
    () =>
      baseThemes.filter((theme) => {
        const displayName = themeNameMap[theme] || theme;
        return (
          displayName.toLowerCase().includes(searchText.toLowerCase()) ||
          theme.toLowerCase().includes(searchText.toLowerCase())
        );
      }),
    [searchText]
  );

  const filteredBackgroundThemes = useMemo(
    () =>
      BACKGROUND_THEME_NAMES.filter((theme) => {
        const displayName = themeNameMap[theme] || theme;
        return (
          displayName.toLowerCase().includes(searchText.toLowerCase()) ||
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
        <HStack key={`row-${rowIndex}`} spacing={CARD_GAP} style={styles.row}>
          {row.map((themeName) => (
            <ThemeCard
              key={themeName}
              themeName={themeName}
              isSelected={currentTheme === themeName}
              onPress={() => handleThemePress(themeName)}
              isBackgroundTheme={isBackgroundTheme}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
            />
          ))}
          {/* Fill empty space if odd number */}
          {row.length === 1 && <View style={{ width: cardWidth }} />}
        </HStack>
      ));
    },
    [currentTheme, handleThemePress, cardWidth, cardHeight]
  );

  const hasResults = filteredBaseThemes.length > 0 || filteredBackgroundThemes.length > 0;

  return (
    <Container>
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
              overpass
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
              overpass
              style={[styles.sectionTitle, { color: opacity(foreground, 0.5) }]}>
              COLOR THEMES
            </Text>
            <Spacer size={12} />
            {renderThemeGrid(filteredBaseThemes, false)}
          </View>
        )}
      </ScrollView>
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
  paletteContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
  },
  paletteCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  textOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
  },
  labelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});

export default withSheetProvider(ThemeSettings);
