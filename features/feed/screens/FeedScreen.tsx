import React from 'react';
import { View } from 'react-native';

import { HomeFeed } from '@/features/feed/components/HomeFeed';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export function FeedScreen() {
  const surface = useThemeColor('surface');
  return (
    <View style={{ flex: 1, backgroundColor: surface }}>
      <HomeFeed />
    </View>
  );
}
