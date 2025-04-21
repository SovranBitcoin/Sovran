import { Image } from 'expo-image';

const blurhash = '000000';

export default function App({ style, source }) {
  return (
    <Image
      style={style}
      source={source}
      placeholder={{ blurhash }}
      contentFit="cover"
      transition={1000}
    />
  );
}
