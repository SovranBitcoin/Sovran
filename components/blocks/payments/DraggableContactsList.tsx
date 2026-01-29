import React, { FC, useCallback, useMemo } from 'react';
import { View as RNView, ScrollView, StyleSheet } from 'react-native';
import { ContactItem } from './ContactItem';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { ProfilesCardFrame } from './ProfilesCardFrame';
import opacity from 'hex-color-opacity';

// Memoized wrapper component that receives pre-resolved profile
const RenderItem = React.memo(
  ({
    item,
    profile,
    isLoadingProfiles,
  }: {
    item: any;
    profile: any;
    isLoadingProfiles?: boolean;
  }) => {
    // Only show loading if we're still fetching profiles AND this specific contact doesn't have profile data yet
    const shouldShowLoading = isLoadingProfiles && !profile;

    return <ContactItem item={item} profile={profile} isLoadingProfile={shouldShowLoading} />;
  }
);

RenderItem.displayName = 'RenderItem';

interface DraggableContactsListProps {
  profilesMap: Map<string, any>;
  data: any[];
  isDecrypting: boolean;
  isLoadingProfiles?: boolean;
  emptyMessage: string;
}

export const DraggableContactsList: FC<DraggableContactsListProps> = ({
  profilesMap,
  data,
  isDecrypting,
  isLoadingProfiles = false,
  emptyMessage,
}) => {
  const { getPrimaryColor } = useTheme();

  // Theme colors for the card frame
  const primary50 = useMemo(() => getPrimaryColor('50'), [getPrimaryColor]);
  // Primary accent color for neutral look
  const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  // Border color with opacity for accent-style border effect
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

  const keyExtractor = useCallback((item: any) => {
    return item.pubkey || item.mint?.mintUrl || item.id || Math.random().toString();
  }, []);

  if (isDecrypting) {
    return (
      <RNView style={{ flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 80 }}>
        <Text style={{ color: getPrimaryColor('400'), textAlign: 'center' }}>
          Decrypting messages...
        </Text>
      </RNView>
    );
  }

  if (data.length === 0) {
    return (
      <RNView style={{ flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 80 }}>
        <Text style={{ color: getPrimaryColor('400'), textAlign: 'center' }}>{emptyMessage}</Text>
      </RNView>
    );
  }

  return (
    <ScrollView
      className="mt-3 flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 0 }}>
      <RNView style={[styles.card, { borderColor }]}>
        <ProfilesCardFrame accentColor={accentColor} highlightColor={primary50}>
          <View style={styles.content} className="gap-4">
            {data.map((item) => {
              // Look up profile here so re-renders happen when profiles change
              const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
              return (
                <RenderItem
                  key={keyExtractor(item)}
                  item={item}
                  profile={profile}
                  isLoadingProfiles={isLoadingProfiles}
                />
              );
            })}
          </View>
        </ProfilesCardFrame>
      </RNView>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    marginHorizontal: 16,
  },
  content: {
    padding: 16,
    zIndex: 1,
  },
});
