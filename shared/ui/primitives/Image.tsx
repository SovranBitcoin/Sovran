import React from 'react';
import { Image as ExpoImage, type ImageProps as ExpoImageProps } from 'expo-image';

type ImageProps = ExpoImageProps;

/**
 * Wallpaper-friendly defaults over `expo-image`: aggressive memory+disk caching,
 * a 1s cross-fade, and `cover` content fit. All expo-image props forward
 * untouched, so any default is overridable.
 */
export function Image(props: ImageProps): React.ReactElement {
  return <ExpoImage contentFit="cover" cachePolicy="memory-disk" transition={1000} {...props} />;
}
