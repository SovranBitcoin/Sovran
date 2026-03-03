import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';

export function ThreadScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  return (
    <ModalLayoutWrapper useCustomScrollView>
      <ThreadView eventId={eventId ?? ''} />
    </ModalLayoutWrapper>
  );
}
