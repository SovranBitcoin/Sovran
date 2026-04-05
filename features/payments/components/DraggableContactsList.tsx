import React, { FC, useCallback, useMemo } from 'react';
import { ScrollView, View as RNView, StyleSheet } from 'react-native';
import { ContactItem } from './ContactItem';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

const SKELETON_DATA = Array.from({ length: 4 }, (_, i) => ({
  type: 'contact' as const,
  pubkey: `skeleton-${i}`,
}));

interface DraggableContactsListProps {
  profilesMap: Map<string, any>;
  data: any[];
  /** Show skeleton placeholder items when true and data is empty */
  loading?: boolean;
  isLoadingProfiles?: boolean;
  emptyMessage: string;
}

const RenderItem = React.memo(
  ({
    item,
    profile,
    isLoadingProfile,
    index,
    length,
  }: {
    item: any;
    profile: any;
    isLoadingProfile: boolean;
    index: number;
    length: number;
  }) => (
    <ContactItem
      item={item}
      profile={profile}
      isLoadingProfile={isLoadingProfile}
      index={index}
      length={length}
    />
  )
);

RenderItem.displayName = 'RenderItem';

export const DraggableContactsList: FC<DraggableContactsListProps> = ({
  profilesMap,
  data,
  loading = false,
  isLoadingProfiles = false,
  emptyMessage,
}) => {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);

  const isShowingSkeleton = loading && data.length === 0;
  const displayData = isShowingSkeleton ? SKELETON_DATA : data;

  const getItemProps = useCallback(
    (item: any) => {
      const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
      const isLoadingProfile = isShowingSkeleton || (isLoadingProfiles && !profile);
      return { profile, isLoadingProfile };
    },
    [profilesMap, isLoadingProfiles, isShowingSkeleton]
  );

  if (!loading && data.length === 0) {
    return (
      <RNView style={emptyStateStyles.container}>
        <Text style={{ color: opacity(foreground, 0.4), textAlign: 'center' }}>{emptyMessage}</Text>
      </RNView>
    );
  }

  return (
    <Log name="DraggableContactsList">
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={styles.scrollContent}>
        <RNView style={[styles.card, { borderColor }]}>
          <BlurCardFrame accentColor={muted}>
            <View style={styles.content}>
              {displayData.map((item, index) => {
                const key = item.pubkey || item.mint?.mintUrl || `item-${index}`;
                const { profile, isLoadingProfile } = getItemProps(item);
                return (
                  <RenderItem
                    index={index}
                    length={displayData.length}
                    key={key}
                    item={item}
                    profile={profile}
                    isLoadingProfile={isLoadingProfile}
                  />
                );
              })}
            </View>
          </BlurCardFrame>
        </RNView>
      </ScrollView>
    </Log>
  );
};

const emptyStateStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 80,
  },
});

const styles = StyleSheet.create({
  scroll: {
    marginTop: 12,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 0,
    paddingBottom: 120,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: 1,
  },
});
