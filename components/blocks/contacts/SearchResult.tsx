import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
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
  const { getGreenColor, getRedColor } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-primary-800 flex-row items-center rounded-lg p-2"
      disabled={loading || !result.profile}>
      <HStack spacing={8}>
        <ProfileImage loading={loading} profile={result.profile} />
        <HStack className="flex-1">
          <Text loading={loading} overpass bold size={16} className="text-primary-50">
            {result.profile?.displayName || result.profile?.name || 'Loading...'}
          </Text>
          {result.profile?.nip05 && (
            <Text
              loading={loading}
              overpass
              regular
              size={12}
              style={{
                color: result.profile.nip05Valid ? getGreenColor('300') : getRedColor('300'),
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
