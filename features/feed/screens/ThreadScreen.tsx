import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { Screen, feedLog, useLifecycleLogger } from '@/shared/lib/logger';

export function ThreadScreen() {
  useLifecycleLogger('ThreadScreen', feedLog);

  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  feedLog.info('feed.thread.view', { eventId: eventId ?? '' });

  return (
    <ModalLayoutWrapper useCustomScrollView>
      <Screen name="ThreadScreen">
        <ThreadView eventId={eventId ?? ''} />
      </Screen>
    </ModalLayoutWrapper>
  );
}
