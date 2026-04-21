import { useLocalSearchParams, Stack } from 'expo-router';
import { BitChatScreen } from '@/features/bitchat/screens/BitChatScreen';

export default function BitChatRoute() {
  const { geohash, tierLabel } = useLocalSearchParams<{
    geohash: string;
    tierLabel?: string;
  }>();

  if (!geohash) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: tierLabel ? `${tierLabel} Chat` : `#${geohash}`,
        }}
      />
      <BitChatScreen geohash={geohash} tierLabel={tierLabel} />
    </>
  );
}
