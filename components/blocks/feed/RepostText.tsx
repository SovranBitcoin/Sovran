import React from 'react';
import { HStack } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { UserNameProfiles } from 'components/ui/UserNameProfiles';
import { memoizedGetTheme } from 'helper/redux/settings';

interface RepostTextProps {
  pubkey: string;
  repostCounter: number;
}

export function RepostText({ pubkey, repostCounter }: RepostTextProps) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <HStack
      style={{
        marginBottom: 12,
      }}
      align="center">
      <Icon name="garden:arrow-retweet-fill-16" size={16} color={greys(theme)[400]} />

      <UserNameProfiles
        pubkey={pubkey}
        style={{
          fontFamily: 'OverpassBold',
          fontSize: 14,
          color: greys(theme)[400],
        }}
      />
      {repostCounter > 1 ? (
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: greys(theme)[400],
          }}>
          {` and ${repostCounter - 1} other ${
            repostCounter - 1 > 1 ? 'people' : 'person'
          } reposted`}
        </Text>
      ) : (
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: greys(theme)[400],
          }}>
          {' reposted'}
        </Text>
      )}
    </HStack>
  );
}
