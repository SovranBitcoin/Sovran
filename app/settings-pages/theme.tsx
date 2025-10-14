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

// An array of available themes
const themes = [
  'dark',
  'navy',
  'sunset',
  'beige',
  'crimson-night',
  'twilight-amber',
  'velvet-emerald',
];

// Background image themes
export const backgroundImageThemes = {
  royalpurple: require('assets/images/backgrounds/royalpurple.png'),
  mysticblue: require('assets/images/backgrounds/mysticblue.png'),
  cosmicpurple: require('assets/images/backgrounds/cosmicpurple.png'),
  deepocean: require('assets/images/backgrounds/deepocean.png'),
};

// Mapping of theme names to user-friendly names (only for used themes)
const themeNameMap: Record<string, string> = {
  dark: 'Dark',
  navy: 'Navy',
  beige: 'Beige',
  sunset: 'Sunset',
  'crimson-night': 'Crimson Night',
  'twilight-amber': 'Twilight Amber',
  'velvet-emerald': 'Velvet Emerald',
  // Background image themes
  royalpurple: 'Royal Purple',
  mysticblue: 'Mystic Blue',
  cosmicpurple: 'Cosmic Purple',
  deepocean: 'Deep Ocean',
};

function ThemeSettings() {
  const { getPrimaryColor } = useTheme();
  const [searchText, setSearchText] = useState('');
  const setTheme = useSettingsStore((state) => state.setTheme);

  // Combine regular themes and background image themes
  const allThemes = [...themes, ...Object.keys(backgroundImageThemes)];

  const filteredThemes = allThemes.filter((theme) =>
    theme.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleThemePress = (themeName: string) => {
    // Unified theme handling - the store will handle background image themes
    setTheme(themeName);
    router.back();
  };

  const renderThemeIcon = (themeName: string) => {
    // Check if it's a background image theme
    if (Object.keys(backgroundImageThemes).includes(themeName)) {
      const backgroundImage = backgroundImageThemes[themeName];
      return (
        <View className="h-12 w-12 overflow-hidden rounded-full">
          <Image
            source={backgroundImage}
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
        getLabel={(themeName) => themeNameMap[themeName]}
        onItemPress={handleThemePress}
        searchPlaceholder="Search for theme"
      />
    </Container>
  );
}

export default withSheetProvider(ThemeSettings);
