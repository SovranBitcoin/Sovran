import React, { FC, useMemo } from 'react';
import { View as RNView, ScrollView, StyleSheet } from 'react-native';
import { ContactItem } from './ContactItem';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import opacity from 'hex-color-opacity';
import { useThemeColor } from 'hooks/useThemeColor';

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

let fallbackKeyCounter = 0;

export const DraggableContactsList: FC<DraggableContactsListProps> = ({
  profilesMap,
  data,
  isDecrypting,
  isLoadingProfiles = false,
  emptyMessage,
}) => {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);

  if (isDecrypting) {
    return (
      <RNView style={emptyStateStyles.container}>
        <Text style={{ color: opacity(foreground, 0.4), textAlign: 'center' }}>
          Decrypting messages...
        </Text>
      </RNView>
    );
  }

  if (data.length === 0) {
    return (
      <RNView style={emptyStateStyles.container}>
        <Text style={{ color: opacity(foreground, 0.4), textAlign: 'center' }}>{emptyMessage}</Text>
      </RNView>
    );
  }

  return (
    <ScrollView
      style={{ marginTop: 12, flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 0, paddingBottom: 120 }}>
      <RNView style={[styles.card, { borderColor }]}>
        <BlurCardFrame accentColor={muted}>
          <View style={styles.content} className="gap-4">
            {data.map((item) => {
              const profile = item.pubkey ? profilesMap.get(item.pubkey) : undefined;
              const key =
                item.pubkey || item.mint?.mintUrl || item.id || `fallback-${fallbackKeyCounter++}`;
              return (
                <RenderItem
                  key={key}
                  item={item}
                  profile={profile}
                  isLoadingProfiles={isLoadingProfiles}
                />
              );
            })}
          </View>
        </BlurCardFrame>
      </RNView>
    </ScrollView>
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
