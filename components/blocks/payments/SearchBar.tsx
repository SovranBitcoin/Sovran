import React from 'react';
import { View } from 'components/ui/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { router } from 'expo-router';

export const SearchBar = () => {
  return (
    <View className="bg-primary-800 ml-7 mr-1 mt-16 h-12 overflow-hidden rounded-2xl">
      <TouchableOpacity
        onPress={() =>
          router.push({
            pathname: '/contacts',
            params: { unit: 'sat' },
          })
        }>
        <Text
          className="text-primary-500 absolute left-4 top-3.5 text-base"
          style={{ fontFamily: 'OverpassRegular' }}>
          Search for contacts
        </Text>
      </TouchableOpacity>
    </View>
  );
};
