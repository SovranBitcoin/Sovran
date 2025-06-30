import React from 'react';
import { greys } from 'helper/colors';
import 'react-native-gesture-handler';
import { useSelector } from 'react-redux';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';

export function ImageContainer({ url }) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <CachedImage
      style={{
        width: '100%',
        height: 250,
        marginBottom: 8,
        borderRadius: 8,
        backgroundColor: greys(theme)[700],
        borderColor: greys(theme)[600],
        borderWidth: 0.5,
      }}
      source={{ uri: url }}
      resizeMode="contain"
    />
  );
}
