import React from 'react';
import { View } from 'components/ui/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { router } from 'expo-router';

export const SearchBar = () => {
  return (
    <View className="ml-7 mr-1 mt-16 h-12 overflow-hidden rounded-2xl bg-primary-800">
      <TouchableOpacity
        onPress={() =>
          router.push({
            pathname: '/contacts',
            params: { unit: 'sat' },
          })
        }>
        <Text
          className="absolute left-4 top-3.5 text-base text-primary-500"
          style={{ fontFamily: 'OverpassRegular' }}>
          Search for contacts
        </Text>
      </TouchableOpacity>
    </View>
  );
};
