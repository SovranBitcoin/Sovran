import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import opacity from 'hex-color-opacity';
import Icon from '@/assets/icons';
import { SearchTip } from './SearchTip';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

export function NoResultsFound() {
  const foreground = useThemeColor('foreground');
  return (
    <Log name="NoResultsFound">
    <VStack spacing={24} align="center" className="mt-3 px-4">
      <VStack
        justify="center"
        align="center"
        className="bg-surface-secondary h-20 w-20 rounded-full">
        <Icon name="nonicons:error-16" size={40} color={opacity(foreground, 0.4)} />
      </VStack>

      <VStack spacing={12}>
        <Text className="text-center" color={opacity(foreground, 0.5)} bold size={20}>
          No Results Found
        </Text>

        <Text className="text-center" color={opacity(foreground, 0.4)} size={16}>
          {"We couldn't find any users matching your search"}
        </Text>
      </VStack>

      <VStack className="bg-surface-secondary w-full rounded-xl p-4">
        <Text color={opacity(foreground, 0.66)} bold size={16}>
          Try adjusting your search:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="lucide:pencil-line" text="Check your spelling" />
          <SearchTip icon="solar:key-bold" text="Try using a complete public key" />
          <SearchTip icon="mdi:at" text="Use a different NIP-05 identifier" />
        </VStack>
      </VStack>
    </VStack>
    </Log>
  );
}
