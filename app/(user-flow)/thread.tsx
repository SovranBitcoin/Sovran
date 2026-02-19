import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router';
import { ThreadView } from 'components/blocks/ThreadView';

export default function ThreadScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Thread' }} />
      <ThreadView eventId={eventId ?? ''} />
    </>
  );
}
