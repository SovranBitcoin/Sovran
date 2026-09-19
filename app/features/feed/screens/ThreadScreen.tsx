import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';

import { ThreadView } from '@/features/feed/components/ThreadView';
import { Screen } from '@/shared/ui/composed/Screen';
import { feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { DemoThreadView } from '../components/DemoThreadView';

const ParamsSchema = z.object({
  eventId: Hex64,
  preview: z.literal('demo').optional(),
  /** Opened from a post's reply button: focus the reply box once the thread is up. */
  focusReply: z.literal('1').optional(),
});

export function ThreadScreen() {
  useLifecycleLogger('ThreadScreen', feedLog);
  const surface = useThemeColor('surface');
  const mockMode = useSettingsStore((state) => state.mockMode);

  const params = useRouteParams(ParamsSchema, { where: 'user-flow.thread' });
  if (!params) return null;
  const preview = params.preview === 'demo';
  if (preview && !mockMode) return null;

  feedLog.info('feed.thread.view', { eventId: params.eventId });

  return (
    <Screen
      name="ThreadScreen"
      scroll={preview ? 'auto' : 'custom'}
      safeArea={preview ? false : 'scroll'}
      bgColor={surface}
      deferContent={false}>
      {preview ? (
        <DemoThreadView eventId={params.eventId} />
      ) : (
        <ThreadView eventId={params.eventId} focusReplyOnOpen={params.focusReply === '1'} />
      )}
    </Screen>
  );
}
