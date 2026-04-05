import React, { useCallback, useRef } from 'react';
import { Image, ImageSource, ImageStyle } from 'expo-image';
import { StyleProp } from 'react-native';
import { log } from '@/shared/lib/logger';

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
  const t0 = useRef(performance.now());

  const onLoad = useCallback(
    (e: { source: { width: number; height: number; url: string }; cacheType?: string }) => {
      const duration_ms = Math.round((performance.now() - t0.current) * 100) / 100;
      const src =
        typeof source === 'number'
          ? 'asset'
          : typeof source === 'string'
            ? source.slice(0, 40)
            : (source as any)?.uri?.slice(0, 40) ?? 'unknown';
      log.debug('image.loaded', {
        src,
        width: e.source.width,
        height: e.source.height,
        duration_ms,
        cacheType: e.cacheType,
      });
    },
    [source]
  );

  return (
    <Image
      className={className}
      style={style}
      source={source}
      placeholder={{ blurhash: BLUR_HASH }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={transitionDuration}
      onLoad={onLoad}
    />
  );
}
