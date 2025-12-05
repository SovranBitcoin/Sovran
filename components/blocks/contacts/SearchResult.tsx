import React from 'react';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { UserProfile } from 'helper/apiClient';
import { ProfileImage } from './ProfileImage';
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
    <View blur className="flex-row items-center rounded-lg p-4">
      <TouchableOpacity onPress={onPress} disabled={loading || !result.profile}>
        <HStack spacing={8}>
          <ProfileImage loading={loading} profile={result.profile} />
          <VStack spacing={4} className="flex-1">
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
          </VStack>
        </HStack>
      </TouchableOpacity>
    </View>
  );
}
