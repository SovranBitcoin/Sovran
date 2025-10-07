import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { formatAmount } from 'helper/currency';
import { Avatar } from 'components/ui/Avatar';
import { formatCustomDate } from 'helper/time';
import { router } from 'expo-router';
import { PUBLIC_KEYS } from '@/helper/constants';

interface ContactItemProps {
  contact: any;
  isVerified: boolean;
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

export const ContactItem = ({ contact }: ContactItemProps) => {
  const mostRecentTransaction = contact?.transactions?.[0];
  const mostRecentMessage = contact?.messages?.[0];

  const mostRecentActivity = mostRecentTransaction || mostRecentMessage;
  const formattedDate = mostRecentActivity
    ? formatCustomDate(new Date(mostRecentActivity.date || mostRecentActivity.created_at))
    : null;

  const previewText = mostRecentTransaction
    ? `You sent ${formatAmount(
        { amount: mostRecentTransaction.amount, unit: mostRecentTransaction.unit },
        {
          currencyDisplay: mostRecentTransaction.unit === 'sat' ? 'name' : 'symbol',
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
          <VStack style={{ marginRight: 8 }}>
            <Avatar
              picture={contact.profile.picture || contact.profile.image}
              status={
                Object.values(PUBLIC_KEYS).includes(contact.profile.pubkey) ? 'VERIFIED' : undefined
              }
              size={48}
            />
          </VStack>
          <VStack style={styles.textContainer}>
            <Text style={styles.profileName} className="text-primary-0">
              {contact.profile?.displayName || contact.profile?.name || 'Unknown User'}
            </Text>
            <Text style={styles.previewText} className="text-primary-100">
              {previewText.length > 50
                ? `${previewText.slice(0, 50)}...`
                : previewText || 'No activity'}
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
