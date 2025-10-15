import React, { useMemo, useCallback } from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { formatCustomDate } from 'helper/time';
import { router } from 'expo-router';
import { PUBLIC_KEYS } from '@/helper/constants';
import { getMintDisplayName } from '@/helper/url';

interface ContactItemProps {
  item: {
    type: 'contact' | 'mint';
    pubkey: string;
    dmEvent?: any;
    mint?: any;
    mintInfo?: any;
    timestamp?: number;
  };
}

const styles = {
  contactItem: {
    marginBottom: 8,
    marginTop: 8,
  },
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
  date: {
    marginLeft: 8,
    fontFamily: 'OverpassBold',
    fontSize: 16,
  },
  previewText: {
    fontFamily: 'OverpassRegular',
    fontSize: 16,
    marginTop: 2,
  },
};

export const ContactItem = React.memo(({ item }: ContactItemProps) => {
  console.log(`[PERF] ContactItem render for ${item.type}:${item.pubkey || item.mint?.mintUrl}`);

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

    // Regular contact - use pubkey as name
    return {
      name: item.pubkey.slice(0, 16) + '...',
      picture: undefined,
      subtitle: item.dmEvent?.content || 'No messages',
      isMint: false,
    };
  }, [item.type, item.mint?.mintUrl, item.mintInfo, item.pubkey, item.dmEvent?.content]);

  // Format date
  const formattedDate = useMemo(() => {
    if (!item.dmEvent?.created_at) return null;
    return formatCustomDate(new Date(item.dmEvent.created_at * 1000));
  }, [item.dmEvent?.created_at]);

  const handlePress = useCallback(() => {
    if (item.pubkey) {
      router.push({
        pathname: '/userMessages',
        params: {
          pubkey: item.pubkey,
        },
      });
    }
  }, [item.pubkey]);

  return (
    <TouchableOpacity style={styles.contactItem} onPress={handlePress}>
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
            />
          </VStack>
          <VStack style={styles.textContainer}>
            <Text style={styles.profileName} className="text-primary-0">
              {displayInfo.name}
            </Text>
            <Text style={styles.previewText} className="text-primary-100">
              {displayInfo.subtitle.length > 50
                ? `${displayInfo.subtitle.slice(0, 50)}...`
                : displayInfo.subtitle}
            </Text>
          </VStack>
        </HStack>
        {formattedDate && (
          <Text style={styles.date} className="text-primary-200">
            {formattedDate}
          </Text>
        )}
      </HStack>
    </TouchableOpacity>
  );
});

ContactItem.displayName = 'ContactItem';
