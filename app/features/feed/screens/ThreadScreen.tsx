import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { Screen } from '@/shared/ui/composed/Screen';
import { feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

const ParamsSchema = z.object({
  eventId: Hex64,
});

export function ThreadScreen() {
  useLifecycleLogger('ThreadScreen', feedLog);
  const surface = useThemeColor('surface');

  const params = useRouteParams(ParamsSchema, { where: 'user-flow.thread' });
  if (!params) return null;

  feedLog.info('feed.thread.view', { eventId: params.eventId });

  return (
    <Screen name="ThreadScreen" scroll="custom" bgColor={surface}>
      <ThreadView eventId={params.eventId} />
    </Screen>
  );
}
