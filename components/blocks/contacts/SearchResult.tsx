import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import opacity from 'hex-color-opacity';
import { UserProfile } from 'helper/apiClient';
import { ProfileImage } from './ProfileImage';
import { useThemeColor } from 'hooks/useThemeColor';

interface SearchResultProps {
  result: {
    pubkey: string;
    profile?: UserProfile;
  };
  onPress: () => void;
  loading: boolean;
}

export function SearchResult({ result, onPress, loading }: SearchResultProps) {
  const [foreground, danger, success] = useThemeColor(['foreground', 'danger', 'success'] as const);
  const title =
    result.profile?.displayName ||
    result.profile?.name ||
    (result.profile?.npub
      ? `${result.profile.npub.slice(0, 12)}…`
      : `${result.pubkey.slice(0, 12)}…`);

  return (
    <TouchableOpacity onPress={onPress} disabled={loading || !result.profile}>
      <HStack spacing={8} align="center">
        <ProfileImage loading={loading} profile={result.profile} />
        <VStack spacing={4} className="flex-1">
          <Text loading={loading} overpass bold size={16} color={opacity(foreground, 0.9)}>
            {title}
          </Text>
          {result.profile?.nip05 && (
            <Text
              loading={loading}
              overpass
              regular
              size={12}
              color={result.profile.nip05Valid ? success : danger}>
              {result.profile.nip05Valid ? '✓ ' : '✗ '}
              {result.profile.nip05}
            </Text>
          )}
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
}
