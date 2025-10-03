import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { formatCurrency } from 'helper/currency';
import { greys, Theme } from 'helper/colors';
import { VerifiedIcon } from 'assets/icons';
import CachedImage from 'components/ui/Image';
import { formatCustomDate } from 'helper/time';
import { router } from 'expo-router';

interface ContactItemProps {
  contact: any;
  isVerified: boolean;
  theme: Theme;
}

const ProfilePicture = ({
  imageUri,
  isVerified,
  theme: _theme,
}: {
  imageUri: string;
  isVerified: boolean;
  theme: Theme;
}) => {
  return (
    <VStack style={styles.profilePictureContainer} align="center" justify="center">
      {isVerified && (
        <VStack style={styles.verifiedIconContainer}>
          <VerifiedIcon />
        </VStack>
      )}
      {imageUri ? (
        <CachedImage style={styles.profilePicture} source={{ uri: imageUri }} />
      ) : (
        <VStack style={styles.placeholderCircle} />
      )}
    </VStack>
  );
};

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
  profileName: (theme: Theme) => ({
    color: greys(theme)[0],
    fontFamily: 'OverpassBold',
    fontSize: 16,
  }),
  date: (theme: Theme) => ({
    marginLeft: 8,
    color: greys(theme)[200],
    fontFamily: 'OverpassBold',
    fontSize: 16,
  }),
  previewText: (theme: Theme) => ({
    color: greys(theme)[100],
    fontFamily: 'OverpassRegular',
    fontSize: 16,
    marginTop: 2,
  }),
  profilePictureContainer: {
    position: 'relative' as const,
    width: 48,
    height: 48,
    marginRight: 8,
  },
  verifiedIconContainer: {
    position: 'absolute' as const,
    bottom: -4,
    right: -4,
    zIndex: 100,
    borderRadius: 100,
    height: 20,
    width: 20,
    backgroundColor: greys('dark')[800],
  },
  profilePicture: {
    width: 48,
    height: 48,
    borderRadius: 1000,
    borderColor: greys('dark')[600],
    borderWidth: 0.2,
  },
  placeholderCircle: {
    width: 48,
    height: 48,
    borderRadius: 1000,
    borderColor: greys('dark')[950],
    borderWidth: 0.2,
    backgroundColor: greys('dark')[600],
  },
};

export const ContactItem = ({ contact, isVerified, theme }: ContactItemProps) => {
  const mostRecentTransaction = contact?.transactions?.[0];
  const mostRecentMessage = contact?.messages?.[0];

  const mostRecentActivity = mostRecentTransaction || mostRecentMessage;
  const formattedDate = mostRecentActivity
    ? formatCustomDate(new Date(mostRecentActivity.date || mostRecentActivity.created_at))
    : null;

  const previewText = mostRecentTransaction
    ? `You sent ${formatCurrency(
        {
          currency:
            mostRecentTransaction.unit === 'sat' ? 'BTC' : mostRecentTransaction.unit.toUpperCase(),
          value: mostRecentTransaction.amount,
          denomination: mostRecentTransaction.unit === 'sat' ? 'sats' : mostRecentTransaction.unit,
        },
        {
          locale: 'en-US',
          precision: mostRecentTransaction.unit === 'sat' ? 0 : 2,
          currencyDisplay: mostRecentTransaction.unit === 'sat' ? 'name' : 'symbol',
          denomination: mostRecentTransaction.unit === 'sat' ? 'sats' : mostRecentTransaction.unit,
        }
      )}`
    : mostRecentMessage
      ? mostRecentMessage.content
      : '';

  return (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => {
        if (contact.profile) {
          router.push({
            pathname: '/userMessages',
            params: {
              pubkey: contact.profile?.pubkey,
              profile: JSON.stringify(contact.profile),
            },
          });
        } else {
        }
      }}>
      <HStack align="center" justify="space-between" style={styles.row}>
        <HStack align="center">
          <ProfilePicture
            imageUri={contact.profile.picture || contact.profile.image}
            isVerified={isVerified}
            theme={theme}
          />
          <VStack style={styles.textContainer}>
            <Text style={styles.profileName(theme)}>
              {contact.profile?.displayName || contact.profile?.name || 'Unknown User'}
            </Text>
            <Text style={styles.previewText(theme)}>
              {previewText.length > 50
                ? `${previewText.slice(0, 50)}...`
                : previewText || 'No activity'}
            </Text>
          </VStack>
        </HStack>
        {formattedDate && <Text style={styles.date(theme)}>{formattedDate}</Text>}
      </HStack>
    </TouchableOpacity>
  );
};
