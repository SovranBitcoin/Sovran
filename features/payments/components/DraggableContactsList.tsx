import React, { FC, useCallback, useMemo } from 'react';
import { ScrollView, View as RNView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { ContactRow, mintIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, paymentLog } from '@/shared/lib/logger';
import { PUBLIC_KEYS } from '@/shared/lib/constants';
import { getMintDisplayName } from '@/shared/lib/url';

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

/** Truncate a DM preview so it fits on the subtitle line without wrapping
 *  or ellipsizing mid-sentence. The 50-char ceiling matches the previous
 *  `ContactItem` behaviour so existing designs hold. */
function truncateMessage(content: string | undefined): string | undefined {
  if (!content) return content;
  return content.length > 50 ? `${content.slice(0, 50)}...` : content;
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
  }) => {
    const router = useRouter();

    const pubkey: string = item.pubkey;
    const isMint = item.type === 'mint';
    const mintUrl: string | undefined = item.mint?.mintUrl;
    const isVerified =
      !isMint && !!pubkey && Object.values(PUBLIC_KEYS).includes(pubkey as any);

    // Item's latest DM preview. For contact-type items this is the subtitle
    // verbatim (replies-mode); for mint-type items it falls back to the
    // mint URL then a 'No messages' literal so there's always a second line.
    const dmContent: string | undefined = item.dmEvent?.content;
    const subtitle = isMint
      ? truncateMessage(dmContent) || mintUrl || 'No messages'
      : item.dmEvent === undefined
        ? undefined
        : truncateMessage(dmContent) || 'No messages';

    const identity = isMint
      ? mintIdentity({
          mintUrl: mintUrl ?? '',
          displayName: getMintDisplayName(mintUrl ?? '', item.mintInfo),
          iconUrl: item.mintInfo?.icon_url,
        })
      : nostrIdentity(pubkey, profile, { isLoadingProfile, verified: isVerified });

    const handlePress = () => {
      if (!pubkey) return;
      paymentLog.debug('contact_item.press', {
        type: item.type,
        pubkey: pubkey.slice(0, 16),
      });
      router.navigate({
        pathname: '/(user-flow)/profile' as const,
        params: { pubkey },
      });
    };

    // First + last rows need a little card-edge breathing room so the
    // BlurCardFrame corners don't clip the row content.
    const isFirst = index === 0;
    const isLast = index === length - 1;
    const row = (
      <ContactRow
        identity={identity}
        subtitle={subtitle}
        hideMetadata={!!dmContent}
        onPress={handlePress}
        testID={`contact-row:${isMint ? 'mint' : 'nostr'}:${pubkey}`}
      />
    );
    if (!isFirst && !isLast) return row;
    return (
      <RNView style={{ paddingTop: isFirst ? 4 : 0, paddingBottom: isLast ? 4 : 0 }}>
        {row}
      </RNView>
    );
  }
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
