import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  StoriesCarousel,
  type StoryUser,
} from '@/features/feed/components/stories/StoriesCarousel';

const CLOSE_DELAY_MS = 350;

export function StoriesScreen() {
  const insets = useSafeAreaInsets();
  const { startIndex, storyUsersJson } = useLocalSearchParams<{
    startIndex?: string;
    storyUsersJson?: string;
  }>();

  const [isClosing, setIsClosing] = useState(false);
  const closeRequestedRef = useRef(false);

  const storyUsers = useMemo<StoryUser[]>(() => {
    if (!storyUsersJson) return [];
    try {
      return JSON.parse(storyUsersJson);
    } catch {
      return [];
    }
  }, [storyUsersJson]);

  const handleClose = () => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
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
      setTimeout(() => router.back(), 0);
    }
    return null;
  }

  return (
    <View
      className="flex-1 bg-black"
      style={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 6 }}>
      <StoriesCarousel
        storyUsers={storyUsers}
        startIndex={Number(startIndex) || 0}
        onClose={handleClose}
        isClosing={isClosing}
      />
    </View>
  );
}
