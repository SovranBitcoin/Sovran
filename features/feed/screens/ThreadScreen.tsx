import React from 'react';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { Screen } from '@/shared/ui/composed/Screen';
import { feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  eventId: Hex64,
});

export function ThreadScreen() {
  useLifecycleLogger('ThreadScreen', feedLog);

  const params = useRouteParams(ParamsSchema, { where: 'user-flow.thread' });
  if (!params) return null;

  feedLog.info('feed.thread.view', { eventId: params.eventId });

  return (
    <Screen name="ThreadScreen" scroll="custom">
      <ThreadView eventId={params.eventId} />
    </Screen>
  );
}
