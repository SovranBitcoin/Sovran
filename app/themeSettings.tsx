import React, { useState } from 'react';

import { greys } from 'helper/colors';
import { View } from 'components/common/View';
import { useNavigation } from 'expo-router';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { ThemeIcon } from 'assets/icons';
import { SearchableList } from 'components/common/SearchableList';
import Container from 'components/layout/Container';
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

// Mapping of theme names to user-friendly names (only for used themes)
const themeNameMap: Record<string, string> = {
  dark: 'Dark',
  navy: 'Navy',
  beige: 'Beige',
  sunset: 'Sunset',
  'crimson-night': 'Crimson Night',
  'twilight-amber': 'Twilight Amber',
  'velvet-emerald': 'Velvet Emerald',
};

function ThemeSettings() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const [searchText, setSearchText] = useState('');
  const { setTheme, setBackgroundImage } = useSettings();

  const filteredThemes = themes.filter((theme) =>
    theme.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleThemePress = (themeName: string) => {
    setTheme(themeName);
    setBackgroundImage('');
    navigation.goBack();
  };

  const renderThemeIcon = (themeName: string) => (
    <View
      style={{
        backgroundColor: greys(themeName)[300],
        borderRadius: 100,
      }}>
      <ThemeIcon color={greys(themeName)[800]} />
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
