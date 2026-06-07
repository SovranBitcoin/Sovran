import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import type {
  FeedNotificationPolicy,
  FeedNotificationReplyScope,
} from '@/features/feed/data/feedClient';

const DEFAULT_NOTIFICATION_POLICY: FeedNotificationPolicy = 'RELAXED';
const DEFAULT_NOTIFICATION_REPLY_SCOPE: FeedNotificationReplyScope = 'DIRECT';

type NotificationPolicyState = {
  policy: FeedNotificationPolicy;
  replyScope: FeedNotificationReplyScope;
};

type NotificationPolicyActions = {
  setPolicy: (policy: FeedNotificationPolicy) => void;
  setReplyScope: (replyScope: FeedNotificationReplyScope) => void;
  resetNotificationPolicy: () => void;
};

type NotificationPolicyStore = NotificationPolicyState & NotificationPolicyActions;

const PersistedNotificationPolicyStore = z.object({
  policy: z.enum(['RELAXED', 'MODERATE', 'STRICT', 'FOLLOWS']).default(DEFAULT_NOTIFICATION_POLICY),
  replyScope: z.enum(['DIRECT', 'THREAD']).default(DEFAULT_NOTIFICATION_REPLY_SCOPE),
});

export const useNotificationPolicyStore = create<NotificationPolicyStore>()(
  persist(
    (set) => ({
      policy: DEFAULT_NOTIFICATION_POLICY,
      replyScope: DEFAULT_NOTIFICATION_REPLY_SCOPE,

      setPolicy: (policy) => {
        storeLog.info('feed.notification_policy.set', { policy });
        set({ policy });
      },

      setReplyScope: (replyScope) => {
        storeLog.info('feed.notification_reply_scope.set', { replyScope });
        set({ replyScope });
      },

      resetNotificationPolicy: () =>
        set({
          policy: DEFAULT_NOTIFICATION_POLICY,
          replyScope: DEFAULT_NOTIFICATION_REPLY_SCOPE,
        }),
    }),
    persistConfig({
      name: 'notification-policy-store',
      storage: createProfileScopedStorage(),
      schema: PersistedNotificationPolicyStore,
      logKey: 'notification_policy',
      partialize: (state) => ({
        policy: state.policy,
        replyScope: state.replyScope,
      }),
    })
  )
);
