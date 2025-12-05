import React from 'react';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { UserNameProfiles } from 'components/ui/UserNameProfiles';

interface RepostTextProps {
  pubkey: string;
  repostCounter: number;
}

export function RepostText({ pubkey, repostCounter }: RepostTextProps) {
  return (
    <HStack className="mb-3" align="center">
      <Icon name="garden:arrow-retweet-fill-16" size={16} className="text-primary-400" />

      <UserNameProfiles pubkey={pubkey} />
      {repostCounter > 1 ? (
        <Text className="text-primary-400" size={14} bold overpass>
          {` and ${repostCounter - 1} other ${
            repostCounter - 1 > 1 ? 'people' : 'person'
          } reposted`}
        </Text>
      ) : (
        <Text className="text-primary-400" size={14} bold overpass>
          {' reposted'}
        </Text>
      )}
    </HStack>
  );
}
