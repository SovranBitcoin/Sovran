import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { StoriesCarousel, type StoryUser } from '@/features/feed/components/nostr/StoriesCarousel';
import { Screen, feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const CLOSE_DELAY_MS = 350;

const ParamsSchema = z.object({
  startIndex: z
    .string()
    .regex(/^\d{1,5}$/)
    .optional(),
  storyUsersJson: z.string().min(1).max(64_000).optional(),
});

export function StoriesScreen() {
  useLifecycleLogger('StoriesScreen', feedLog);

  const insets = useSafeAreaInsets();
  const params = useRouteParams(ParamsSchema, { where: 'stories-flow.stories' });
  const startIndex = params?.startIndex;
  const storyUsersJson = params?.storyUsersJson;

  const [isClosing, setIsClosing] = useState(false);
  const closeRequestedRef = useRef(false);

  const storyUsers = useMemo<StoryUser[]>(() => {
    if (!storyUsersJson) return [];
    try {
      return JSON.parse(storyUsersJson);
    } catch (e) {
      feedLog.error('feed.stories.parse_failed', {
        error: e instanceof Error ? e : new Error(String(e)),
      });
      return [];
    }
  }, [storyUsersJson]);

  feedLog.debug('feed.stories.open', {
    startIndex: Number(startIndex) || 0,
    userCount: storyUsers.length,
  });

  const handleClose = () => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    feedLog.info('feed.stories.close');
    setIsClosing(true);
  };

  useEffect(() => {
    if (!isClosing) return;
    const t = setTimeout(() => {
      router.back();
    }, CLOSE_DELAY_MS);
    return () => clearTimeout(t);
  }, [isClosing]);

  if (storyUsers.length === 0) {
    if (!closeRequestedRef.current) {
      closeRequestedRef.current = true;
      feedLog.warn('feed.stories.empty', { reason: 'no_story_users' });
      setTimeout(() => router.back(), 0);
    }
    return null;
  }

  return (
    <Screen
      name="StoriesScreen"
      style={{
        flex: 1,
        backgroundColor: 'black',
        paddingTop: insets.top + 6,
        paddingBottom: insets.bottom + 6,
      }}>
      <StoriesCarousel
        storyUsers={storyUsers}
        startIndex={Number(startIndex) || 0}
        onClose={handleClose}
        isClosing={isClosing}
      />
    </Screen>
  );
}
