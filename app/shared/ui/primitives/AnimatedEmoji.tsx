import { useState } from 'react';
import { Image } from 'expo-image';
import { Text } from '@/shared/ui/primitives/Text';

const NOTO_CDN = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

function getAnimatedEmojiUrl(emoji: string): string {
  const codepoints = Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== 'fe0f');
  return `${NOTO_CDN}/${codepoints.join('_')}/512.webp`;
}

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
}

export function AnimatedEmoji({ emoji, size = 28 }: AnimatedEmojiProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Text style={{ fontSize: size }}>{emoji}</Text>;
  }

  return (
    <Image
      source={{ uri: getAnimatedEmojiUrl(emoji) }}
      style={{ width: size, height: size }}
      cachePolicy="memory-disk"
      autoplay
      onError={() => setFailed(true)}
    />
  );
}
