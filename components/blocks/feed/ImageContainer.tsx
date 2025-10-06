import React from 'react';
import 'react-native-gesture-handler';
import CachedImage from 'components/ui/Image';

export function ImageContainer({ url }: { url: string }) {
  return (
    <CachedImage
      className="bg-primary-700 border-primary-600 mb-2 h-[250px] w-full rounded-lg border"
      source={{ uri: url }}
      // resizeMode="contain"
    />
  );
}
