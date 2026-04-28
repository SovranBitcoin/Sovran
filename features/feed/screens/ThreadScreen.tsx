import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { Screen } from '@/shared/ui/composed/Screen';
import { feedLog, useLifecycleLogger } from '@/shared/lib/logger';

export function ThreadScreen() {
  useLifecycleLogger('ThreadScreen', feedLog);

  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  feedLog.info('feed.thread.view', { eventId: eventId ?? '' });

  return (
    <Screen name="ThreadScreen" scroll="custom">
      <ThreadView eventId={eventId ?? ''} />
    </Screen>
  );
}
