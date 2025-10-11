import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { formatCustomDate } from 'helper/time';
import { router } from 'expo-router';
import { PUBLIC_KEYS } from '@/helper/constants';
import { npubToPubkey } from 'components/blocks/Transaction';
import { getMintDisplayName } from '@/helper/url';

interface ContactItemProps {
  // Most recent activity
  mostRecentMessage?: any;

  // Data sources for profile info
  mintInfo?: any; // From getMintInfo()
  nostrInfo?: any; // From nostr profile

  // Fallback for mints
  mintUrl?: string;
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

export const ContactItem = ({
  mostRecentMessage,
  mintInfo,
  nostrInfo,
  mintUrl,
}: ContactItemProps) => {
  // Extract profile info from available data sources
  const getProfileInfo = () => {
    // Priority: nostrInfo > mintInfo nostr contact > mintInfo > fallback
    if (nostrInfo) {
      return {
        name: nostrInfo.display_name || nostrInfo.name || 'Unknown User',
        picture: nostrInfo.picture || nostrInfo.image,
        pubkey: nostrInfo.pubkey,
      };
    }

    if (mintInfo) {
      // Check if mint has nostr contact info
      const nostrContact = mintInfo.contact?.find((contact: any) => contact.method === 'nostr');
      if (nostrContact?.info) {
        try {
          // Convert npub to pubkey using existing utility
          const pubkey = npubToPubkey(nostrContact.info);
          if (pubkey) {
            return {
              name: getMintDisplayName(mintUrl || '', mintInfo),
              picture: mintInfo.icon_url,
              pubkey: pubkey,
            };
          }
        } catch (error) {
          console.warn('Failed to decode nostr contact from mint:', error);
        }
      }

      return {
        name: getMintDisplayName(mintUrl || '', mintInfo),
        picture: mintInfo.icon_url,
        pubkey: undefined,
      };
    }

    // Fallback for mints
    if (mintUrl) {
      return {
        name: getMintDisplayName(mintUrl),
        picture: undefined,
        pubkey: undefined,
      };
    }

    return {
      name: 'Unknown',
      picture: undefined,
      pubkey: undefined,
    };
  };

  const profile = getProfileInfo();

  // Determine subtitle text
  const getSubtitle = () => {
    if (mostRecentMessage) {
      return mostRecentMessage.content;
    }

    // Fallback for mints
    if (mintUrl) {
      return mintUrl;
    }

    return 'No activity';
  };

  // Determine date
  const formattedDate = mostRecentMessage
    ? formatCustomDate(
        new Date(
          mostRecentMessage.date || mostRecentMessage.created_at || mostRecentMessage.createdAt
        )
      )
    : null;

  const subtitle = getSubtitle();

  return (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => {
        if (profile.pubkey) {
          // Navigate to userMessages with the pubkey
          router.push({
            pathname: '/userMessages',
            params: {
              pubkey: profile.pubkey,
              profile: JSON.stringify(profile),
            },
          });
        } else {
          // TODO: Handle mint-specific navigation (e.g., mint details page)
        }
      }}>
      <HStack align="center" justify="space-between" style={styles.row}>
        <HStack align="center">
          <VStack style={{ marginRight: 8 }}>
            <Avatar
              picture={profile.picture}
              variant={mintInfo ? 'mint' : 'person'}
              status={
                profile.pubkey && Object.values(PUBLIC_KEYS).includes(profile.pubkey)
                  ? 'VERIFIED'
                  : undefined
              }
              size={48}
              name={profile.name}
            />
          </VStack>
          <VStack style={styles.textContainer}>
            <Text style={styles.profileName} className="text-primary-0">
              {profile.name}
            </Text>
            <Text style={styles.previewText} className="text-primary-100">
              {subtitle.length > 50 ? `${subtitle.slice(0, 50)}...` : subtitle}
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
};
