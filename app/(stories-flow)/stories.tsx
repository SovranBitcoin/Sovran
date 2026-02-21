import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoriesCarousel, type StoryUser } from 'components/blocks/nostr/StoriesCarousel';

export default function StoriesScreen() {
  const insets = useSafeAreaInsets();
  const { startIndex, storyUsersJson } = useLocalSearchParams<{
    startIndex?: string;
    storyUsersJson?: string;
  }>();

  const storyUsers = useMemo<StoryUser[]>(() => {
    if (!storyUsersJson) return [];
    try {
      return JSON.parse(storyUsersJson);
    } catch {
      return [];
    }
  }, [storyUsersJson]);

  const handleClose = () => {
    router.back();
  };

  if (storyUsers.length === 0) {
    handleClose();
    return null;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 6 }]}>
      <StoriesCarousel
        storyUsers={storyUsers}
        startIndex={Number(startIndex) || 0}
        onClose={handleClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
