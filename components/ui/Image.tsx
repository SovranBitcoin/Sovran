import React from 'react';
import { Image, ImageSource, ImageStyle } from 'expo-image';
import { StyleProp, View, StyleSheet, Dimensions } from 'react-native';

const BLUR_HASH = '000000';

interface AppProps {
  style?: StyleProp<ImageStyle>;
  source: ImageSource;
  transitionDuration?: number;
}

/**
 * Image component that displays an image with a blur hash placeholder
 * while the image is loading.
 */
export default function App({
  style,
  source,
  transitionDuration = 1000,
}: AppProps): React.ReactElement {
  return (
    <Image
      style={style}
      source={source}
      placeholder={{ blurhash: BLUR_HASH }}
      contentFit="cover"
      transition={transitionDuration}
    />
  );
}

interface SpriteProps {
  source: ImageSource;
  width?: number; // Optional override for layout width
}

export function SpriteView({ source, width }: SpriteProps) {
  const SPRITE_WIDTH = 3072;
  const SPRITE_HEIGHT = 1536;
  const FRAME_COUNT = 4;
  const FRAME_WIDTH = SPRITE_WIDTH / FRAME_COUNT;

  const screen = Dimensions.get('window');
  const renderWidth = width ?? screen.width;
  const scale = screen.height / SPRITE_HEIGHT;
  const renderHeight = screen.height;

  // Time-based index selection
  const hour = new Date().getHours();
  let index = 0;
  if (hour >= 6 && hour < 12)
    index = 0; // Morning
  else if (hour >= 12 && hour < 18)
    index = 1; // Afternoon
  else if (hour >= 18 && hour < 21)
    index = 2; // Evening
  else index = 3; // Night

  return (
    <View
      style={[
        styles.frame,
        { width: renderWidth, height: renderHeight, transform: [{ scale: 1.1 }] },
      ]}>
      <Image
        source={source}
        style={[
          styles.sprite,
          {
            width: SPRITE_WIDTH * scale,
            height: SPRITE_HEIGHT * scale,
            transform: [{ translateX: -index * FRAME_WIDTH * scale }],
          },
        ]}
        contentFit="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    position: 'relative',
  },
  sprite: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
});
