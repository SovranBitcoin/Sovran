import React from 'react';
import { View } from 'react-native';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import 'react-native-gesture-handler';
import { useNostrEvents } from 'nostr-react';
import { useNostrProfile } from './useNostrProfile';
import { Avatar } from 'components/ui/Avatar';
import { useTheme } from 'providers/ThemeProvider';
import { getTimeAgo } from 'helper/time';

interface PostQuoteProps {
  id: string;
}

export const PostQuote = React.memo(({ id }: PostQuoteProps) => {
  const { getPrimaryColor } = useTheme();

  const { events } = useNostrEvents({ filter: { ids: [id] } });
  const authorPubKey = events?.[0]?.pubkey;

  const profile = useNostrProfile({ id: authorPubKey });

  let timeAgo = getTimeAgo(events?.[0]?.created_at);

  const avatarPicture =
    (profile as any)?.picture ||
    (profile as any)?.profile?.picture ||
    (profile as any)?.image ||
    (profile as any)?.profile?.image;

  const displayName =
    (profile as any)?.displayName ||
    (profile as any)?.profile?.displayName ||
    (profile as any)?.display_name ||
    (profile as any)?.profile?.display_name ||
    (profile as any)?.name ||
    (profile as any)?.profile?.name ||
    'User';

  return (
    <View
      style={{
        backgroundColor: getPrimaryColor('800'),
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
        marginLeft: 56,
      }}>
      <HStack align="center">
        <Avatar picture={avatarPicture} size={32} variant="person" alt={displayName} />
        <HStack
          style={{
            marginLeft: 4,
            marginBottom: 4,
          }}
          align="center">
          <Text>{displayName}</Text>
          <Text
            style={{
              color: getPrimaryColor('100'),
            }}>
            {'  '}•{'  '}
            {timeAgo}
          </Text>
        </HStack>
      </HStack>
      <Text>{events?.[0]?.content}</Text>
    </View>
  );
});

PostQuote.displayName = 'PostQuote';
