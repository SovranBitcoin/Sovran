import React, { useEffect, useMemo } from 'react';
import { Pressable } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { Link } from 'expo-router';
import opacity from 'hex-color-opacity';
import { PUBLIC_KEYS } from '@/helper/constants';
import { getMintDisplayName } from '@/helper/url';
import { prefetchImage } from '@/helper/imageCache';
import { useThemeColor } from 'hooks/useThemeColor';

interface ContactItemProps {
  item: {
    type: 'contact' | 'mint';
    pubkey: string;
    dmEvent?: any;
    mint?: any;
    mintInfo?: any;
    timestamp?: number;
  };
  profile?: {
    name?: string;
    display_name?: string;
    picture?: string;
    about?: string;
    nip05?: string;
  };
  isLoadingProfile?: boolean;
}

const styles = {
  contactItem: {},
  row: {
    flex: 1,
  },
  textContainer: {
    flex: 1,
  },
  profileName: {
    fontFamily: 'OverpassBold',
    fontSize: 16,
  },
  previewText: {
    fontFamily: 'OverpassRegular',
    fontSize: 16,
    marginTop: 2,
  },
};

// Memoized ContactItem component to prevent unnecessary re-renders in lists
export const ContactItem = React.memo(function ContactItem({
  item,
  profile,
  isLoadingProfile = false,
}: ContactItemProps) {
  const foreground = useThemeColor('foreground');
  // Get display info
  const displayInfo = useMemo(() => {
    if (item.type === 'mint') {
      return {
        name: getMintDisplayName(item.mint?.mintUrl || '', item.mintInfo),
        picture: item.mintInfo?.icon_url,
        subtitle: item.dmEvent?.content || item.mint?.mintUrl || 'No messages',
        isMint: true,
      };
    }

    // Regular contact - use profile data from kind 0 event
    const displayName = profile?.display_name || profile?.name || item.pubkey.slice(0, 16) + '...';
    const lastMessage = item.dmEvent?.content || 'No messages';

    return {
      name: displayName,
      picture: profile?.picture,
      subtitle: lastMessage,
      isMint: false,
    };
  }, [item.type, item.mint?.mintUrl, item.mintInfo, item.pubkey, item.dmEvent?.content, profile]);

  useEffect(() => {
    prefetchImage(displayInfo.picture);
  }, [displayInfo.picture]);

  const linkHref = useMemo(
    () =>
      item.pubkey
        ? {
            pathname: '/(user-flow)/profile' as const,
            params: { pubkey: item.pubkey },
          }
        : null,
    [item.pubkey]
  );

  const content = (
    <HStack align="center" justify="space-between" style={styles.row}>
      <HStack align="center">
        <VStack style={{ marginRight: 8 }}>
          <Avatar
            picture={displayInfo.picture}
            seed={item.pubkey}
            variant={displayInfo.isMint ? 'mint' : 'person'}
            status={
              item.pubkey && Object.values(PUBLIC_KEYS).includes(item.pubkey as any)
                ? 'VERIFIED'
                : undefined
            }
            size={48}
            name={displayInfo.name}
            loading={isLoadingProfile}
          />
        </VStack>
        <VStack style={styles.textContainer}>
          <Text style={styles.profileName} className="text-foreground">
            {displayInfo.name}
          </Text>
          <Text style={[styles.previewText, { color: opacity(foreground, 0.8) }]}>
            {displayInfo.subtitle.length > 50
              ? `${displayInfo.subtitle.slice(0, 50)}...`
              : displayInfo.subtitle}
          </Text>
        </VStack>
      </HStack>
    </HStack>
  );

  if (linkHref) {
    return (
      <Link href={linkHref as any} asChild>
        <Pressable style={styles.contactItem}>{content}</Pressable>
      </Link>
    );
  }

  return <Pressable style={styles.contactItem}>{content}</Pressable>;
});
