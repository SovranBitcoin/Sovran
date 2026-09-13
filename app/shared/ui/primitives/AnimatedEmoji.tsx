import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { prefetchImage } from '@/shared/lib/imageCache';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const NOTO_CDN = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

function getAnimatedEmojiUrl(emoji: string): string {
  const codepoints = Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== 'fe0f');
  return `${NOTO_CDN}/${codepoints.join('_')}/512.webp`;
}

export async function prefetchAnimatedEmojis(emojis: string[]): Promise<void> {
  await Promise.all(emojis.map((emoji) => prefetchImage(getAnimatedEmojiUrl(emoji))));
}

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
}

export function AnimatedEmoji({ emoji, size = 28 }: AnimatedEmojiProps) {
  // Give each source its own load state, including late native callbacks.
  return <EmojiImage key={emoji} emoji={emoji} size={size} />;
}

function EmojiImage({ emoji, size = 28 }: AnimatedEmojiProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const reducedMotion = useReducedMotion();
  const loaded = status === 'loaded';

  return (
    <View
      className="relative shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={emoji}>
      <Text
        className={loaded ? 'text-center opacity-0' : 'text-center opacity-100'}
        style={{ fontSize: size, lineHeight: size, includeFontPadding: false }}
        accessible={false}>
        {emoji}
      </Text>
      <Image
        source={{ uri: getAnimatedEmojiUrl(emoji) }}
        style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        autoplay={!reducedMotion}
        accessible={false}
        onLoad={() => setStatus((current) => (current === 'failed' ? current : 'loaded'))}
        onError={() => setStatus('failed')}
      />
    </View>
  );
}
