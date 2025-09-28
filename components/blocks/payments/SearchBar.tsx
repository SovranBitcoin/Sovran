import React from 'react';
import { View } from 'components/ui/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { greys, Theme } from 'helper/colors';

interface SearchBarProps {
  theme: Theme;
  navigation: any;
}

const styles = (theme: Theme) => ({
  searchBlurView: {
    marginTop: 64,
    marginLeft: 24,
    marginBottom: 8,
    height: 48,
    overflow: 'hidden' as const,
  },
  searchPressable: {
    flex: 1,
    paddingRight: 30,
    color: greys(theme)[50],
    backgroundColor: greys(theme)[800],
    borderRadius: 16,
    padding: 16,
  },
  searchPlaceholder: {
    position: 'absolute' as const,
    left: 16,
    top: 14,
    fontSize: 16,
    fontFamily: 'OverpassRegular',
    color: greys(theme)[500],
  },
});

export const SearchBar = ({ theme, navigation }: SearchBarProps) => {
  const stylesheet = styles(theme);

  return (
    <View>
      <View style={stylesheet.searchBlurView}>
        <TouchableOpacity
          onPress={() => navigation.navigate('contacts', { unit: 'sat' })}
          style={stylesheet.searchPressable}>
          <Text style={stylesheet.searchPlaceholder}>Search for contacts</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
