import React from 'react';
import { Image, ImageSource, ImageStyle } from 'expo-image';
import { StyleProp } from 'react-native';

const BLUR_HASH = '000000';

interface AppProps {
  style?: StyleProp<ImageStyle>;
  source: ImageSource;
  transitionDuration?: number;
  className?: string;
}

/**
 * Image component that displays an image with a blur hash placeholder
 * while the image is loading.
 */
export default function App({
  style,
  source,
  transitionDuration = 1000,
  className,
}: AppProps): React.ReactElement {
  return (
    <Image
      className={className}
      style={style}
      source={source}
      placeholder={{ blurhash: BLUR_HASH }}
      contentFit="cover"
      transition={transitionDuration}
    />
  );
}
