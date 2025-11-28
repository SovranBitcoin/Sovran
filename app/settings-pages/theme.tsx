import React, { useState } from 'react';

import { View } from 'components/ui/View';
import Image from 'components/ui/Image';
import { router } from 'expo-router';
import { useSettingsStore } from 'stores/settingsStore';
import { useTheme } from 'providers/ThemeProvider';
import { ThemeIcon } from 'assets/icons';
import { SearchableList } from 'components/ui/SearchableList';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import {
  backgroundImageThemes,
  backgroundThemeDisplayNames,
  BACKGROUND_THEME_NAMES,
} from 'config/backgroundImageThemes';

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

function ThemeSettings() {
  const { getPrimaryColor } = useTheme();
  const [searchText, setSearchText] = useState('');
  const setTheme = useSettingsStore((state) => state.setTheme);

  // Combine base themes and background image themes
  const allThemes = [...baseThemes, ...BACKGROUND_THEME_NAMES];

  const filteredThemes = allThemes.filter((theme) =>
    theme.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleThemePress = (themeName: string) => {
    setTheme(themeName);
    router.back();
  };

  const renderThemeIcon = (themeName: string) => {
    // Check if it's a background image theme
    if (backgroundImageThemes[themeName]) {
      return (
        <View className="h-12 w-12 overflow-hidden rounded-full">
          <Image
            source={backgroundImageThemes[themeName]}
            style={{
              width: '100%',
              height: '100%',
              transform: [{ scale: 1.2 }],
            }}
          />
        </View>
      );
    }

    // Regular theme icon
    return (
      <View
        style={{
          backgroundColor: getPrimaryColor('300', themeName),
          borderRadius: 100,
        }}>
        <ThemeIcon color={getPrimaryColor('800', themeName)} />
      </View>
    );
  };

  return (
    <Container>
      <SearchableList
        searchText={searchText}
        onSearchChange={setSearchText}
        data={filteredThemes}
        renderIcon={renderThemeIcon}
        getLabel={(themeName) => themeNameMap[themeName] || themeName}
        onItemPress={handleThemePress}
        searchPlaceholder="Search for theme"
      />
    </Container>
  );
}

export default withSheetProvider(ThemeSettings);
