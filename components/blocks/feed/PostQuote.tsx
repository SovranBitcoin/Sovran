import React from 'react';
import { View } from 'react-native';
import { HStack } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import 'react-native-gesture-handler';
import { useNostrEvents } from 'nostr-react';
import { useNostrProfile } from './useNostrProfile';
import CachedImage from 'components/ui/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { getTimeAgo } from 'helper/time';

interface PostQuoteProps {
  id: string;
}

export const PostQuote = React.memo(({ id }: PostQuoteProps) => {
  const theme = useSelector(memoizedGetTheme);

  const { events } = useNostrEvents({ filter: { ids: [id] } });
  const authorPubKey = events?.[0]?.pubkey;

  const profile = useNostrProfile({ id: authorPubKey });

  let timeAgo = getTimeAgo(events?.[0]?.created_at);

  return (
    <View
      style={{
        backgroundColor: greys(theme)[800],
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
        marginLeft: 56,
      }}>
      <HStack align="center">
        <CachedImage
          style={{ width: 32, height: 32, borderRadius: 100000 }}
          source={{ uri: profile?.picture }}
        />
        <HStack
          style={{
            marginLeft: 4,
            marginBottom: 4,
          }}
          align="center">
          <Text>{profile?.displayName}</Text>
          <Text
            style={{
              color: greys(theme)[100],
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
