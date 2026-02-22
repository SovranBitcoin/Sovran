import { useLocalSearchParams, Stack } from 'expo-router';
import { ThreadView } from 'components/blocks/ThreadView';
import { ModalLayoutWrapper } from 'app/debugModal';

export default function ThreadScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Thread' }} />
      <ModalLayoutWrapper useCustomScrollView>
        <ThreadView eventId={eventId ?? ''} />
      </ModalLayoutWrapper>
    </>
  );
}
