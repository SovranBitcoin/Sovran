import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import opacity from 'hex-color-opacity';
import { UserProfile } from '@/shared/lib/apiClient';
import { ProfileImage } from './ProfileImage';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { PressableFeedback } from 'heroui-native';
import { paymentLog, Log } from '@/shared/lib/logger';

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
  if (loading) {
    return <HStack spacing={8} align="center"></HStack>;
  }
  return (
    <Log name="SearchResult">
      <PressableFeedback animation={false} onPress={() => {
        paymentLog.info('payment.search.result.press', { pubkey: result.pubkey });
        onPress();
      }}>
        <PressableFeedback.Ripple />
        <HStack spacing={8} align="center" style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <ProfileImage loading={loading} profile={result.profile} />
          <VStack spacing={4} className="flex-1">
            <Text
              loading={loading}
              placeholder="Display Name"
              bold
              size={16}
              color={opacity(foreground, 0.9)}>
              {title}
            </Text>
            {result.profile?.nip05 && (
              <Text
                loading={loading}
                placeholder="user@relay.example"
                size={12}
                color={result.profile.nip05Valid ? success : danger}>
                {result.profile.nip05Valid ? '✓ ' : '✗ '}
                {result.profile.nip05}
              </Text>
            )}
          </VStack>
        </HStack>
      </PressableFeedback>
    </Log>
  );
}
