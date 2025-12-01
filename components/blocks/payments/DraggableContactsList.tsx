import React, { FC, useCallback } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { LegendList } from '@legendapp/list';
import { ContactItem } from './ContactItem';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';

// Wrapper component that looks up profile and passes it to ContactItem
const RenderItem = ({
  item,
  profilesMap,
  isLoadingProfiles,
}: {
  item: any;
  profilesMap: Map<string, any>;
  isLoadingProfiles?: boolean;
}) => {
  const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;

  // Only show loading if we're still fetching profiles AND this specific contact doesn't have profile data yet
  const shouldShowLoading = isLoadingProfiles && !profile;

  console.log('[DEBUG RenderItem] Rendering:', {
    pubkey: item.pubkey?.slice(0, 8),
    hasProfile: !!profile,
    profileName: profile?.name || profile?.display_name,
    shouldShowLoading,
  });

  return <ContactItem item={item} profile={profile} isLoadingProfile={shouldShowLoading} />;
};

interface DraggableContactsListProps {
  profilesMap: Map<string, any>;
  data: any[];
  isDecrypting: boolean;
  isLoadingProfiles?: boolean;
  emptyMessage: string;
  itemHeight?: number;
}

export const DraggableContactsList: FC<DraggableContactsListProps> = ({
  profilesMap,
  data,
  isDecrypting,
  isLoadingProfiles = false,
  emptyMessage,
  itemHeight = 80,
}) => {
  const { getPrimaryColor } = useTheme();

  // Debug logging
  console.log('[DEBUG DraggableContactsList] Render:', {
    dataLength: data?.length || 0,
    profilesMapSize: profilesMap.size,
    isDecrypting,
    emptyMessage,
  });
  console.log(
    '[DEBUG DraggableContactsList] First 2 items:',
    data?.slice(0, 2).map((item) => ({
      type: item.type,
      pubkey: item.pubkey?.slice(0, 8),
      hasProfile: profilesMap.has(item.pubkey),
      profile: profilesMap.get(item.pubkey),
    }))
  );

  // Note: LegendList doesn't support onScroll prop the same way as FlatList
  // We'll handle drag gestures differently if needed

  // Container style for pointer events
  const rContainerStyle = useAnimatedStyle(() => {
    return {
      // Always allow pointer events for now - we'll handle this differently
      pointerEvents: 'auto',
    };
  });

  const keyExtractor = useCallback((item: any) => {
    return item.pubkey || item.mint?.mintUrl || item.id || Math.random().toString();
  }, []);

  if (isDecrypting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 80 }}>
        <Text style={{ color: getPrimaryColor('400'), textAlign: 'center' }}>Decrypting messages...</Text>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 80 }}>
        <Text style={{ color: getPrimaryColor('400'), textAlign: 'center' }}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <Animated.View className="mt-3 flex-1" style={rContainerStyle}>
      <LegendList
        key={`list-${profilesMap.size}`}
        data={data}
        estimatedItemSize={itemHeight}
        renderItem={({ item }) => (
          <RenderItem item={item} profilesMap={profilesMap} isLoadingProfiles={isLoadingProfiles} />
        )}
        keyExtractor={keyExtractor}
        style={{
          flex: 1,
        }}
        contentContainerStyle={{}}
        maintainVisibleContentPosition
      />
      {/* Top gradient for visual feedback */}
      {/* <Animated.View
        style={[
          rTopGradientStyle,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 100,
            backgroundColor: getPrimaryColor('900'),
            opacity: 0.8,
          },
        ]}
      /> */}
    </Animated.View>
  );
};
