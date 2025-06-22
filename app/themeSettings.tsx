import React, { useState } from 'react';
import { StyleSheet, Dimensions } from 'react-native';

import { greys } from 'helper/colors';
import { View } from 'components/common/View';
import { useNavigation } from 'expo-router';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { ThemeIcon } from 'assets/icons';
import { SearchableList } from 'components/common/SearchableList';
import Container from 'components/layout/Container';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

// An array of available themes
const themes = [
  // "light",
  'dark',
  'navy',
  // "ocean",
  'sunset',
  // "forest",
  // "rose",
  // "autumn",
  'beige',
  // "light-beige",
  // "middle-beige",
  // "retro-outrun",
  // "dark-grey",
  // "slate-shadow",
  // "mystic-fog",
  // "eclipse-steel",
  // "aurora-twilight",
  'crimson-night',
  'twilight-amber',
  'velvet-emerald',
  // "volcanic-crimson",
  // "urban-concrete",
  // "celestial-aura",
  // "digital-oasis",
  // "cosmic-ember",
  // "neon-dream",
  // "misty-morning",
  // "desert-dune",
  // "tropical-forest",
  // "ice-queen",
  // "coral-sunrise"
  // 'light',
  // 'light',
];

// Mapping of theme names to user-friendly names
const themeNameMap = {
  // light: 'Light',
  light: 'Light',
  dark: 'Dark',
  navy: 'Navy',
  beige: 'Beige',
  rose: 'Rose',
  sunset: 'Sunset',
  'light-beige': 'Light Beige',
  'crimson-night': 'Crimson Night',
  'twilight-amber': 'Twilight Amber',
  'velvet-emerald': 'Velvet Emerald',

  'volcanic-crimson': 'Volcanic Crimson',
  'urban-concrete': 'Urban Concrete',
  'celestial-aura': 'Celestial Aura',

  'digital-oasis': 'Digital Oasis',
  // "cosmic-ember": "Cosmic Ember",
  // "neon-dream": "Neon Dream",

  'misty-morning': 'Misty Morning',
  'desert-dune': 'Desert Dune',
  'tropical-forest': 'Tropical Forest',
  'ice-queen': 'Ice Queen',
  'coral-sunrise': 'Coral Sunrise',

  // Add other themes here as needed
};

interface ThemeSettingsProps {}

function ThemeSettings({}: ThemeSettingsProps) {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const [searchText, setSearchText] = useState('');
  const { setTheme } = useSettings();

  const filteredThemes = themes.filter((theme) =>
    theme.toLowerCase().includes(searchText.toLowerCase())
  );
  // .sort((a, b) => themeNameMap[a].localeCompare(themeNameMap[b]));

  const handleThemePress = (themeName: string) => {
    setTheme(themeName);
    navigation.goBack();
  };

  const renderThemeIcon = (themeName: string) => (
    <View
      style={{
        backgroundColor: greys(themeName)[600],
        borderRadius: 100,
      }}>
      <ThemeIcon color={greys(themeName)[1800]} />
    </View>
  );

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
        theme={theme}
      />
    </Container>
  );
}

export default withSheetProvider(ThemeSettings);

const createStyles = () =>
  StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
      height: Dimensions.get('screen').height - 128,
    },
    content: {},
  });
