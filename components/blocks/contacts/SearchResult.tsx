import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { ProfileImage } from './ProfileImage';
import { UserProfile } from 'helper/apiClient';

interface SearchResultProps {
  result: {
    pubkey: string;
    profile?: UserProfile;
  };
  onPress: () => void;
  loading: boolean;
}

export function SearchResult({ result, onPress, loading }: SearchResultProps) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center rounded-lg p-2"
      style={{ backgroundColor: greys(theme)[800] }}
      disabled={loading || !result.profile}>
      <HStack spacing={8}>
        <ProfileImage loading={loading} profile={result.profile} />
        <HStack className="flex-1">
          <Text loading={loading} overpass bold size={16} style={{ color: greys(theme)[50] }}>
            {result.profile?.displayName || result.profile?.name || 'Loading...'}
          </Text>
          {result.profile?.nip05 && (
            <Text
              loading={loading}
              overpass
              regular
              size={12}
              style={{
                color: result.profile.nip05Valid ? '#10b981' : '#ef4444', // greens[300] : reds[300]
              }}>
              {result.profile.nip05Valid ? '✓ ' : '✗ '}
              {result.profile.nip05}
            </Text>
          )}
        </HStack>
      </HStack>
    </TouchableOpacity>
  );
}
