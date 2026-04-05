import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface SearchTipProps {
  icon: string;
  text: string;
}

export function SearchTip({ icon, text }: SearchTipProps) {
  const foreground = useThemeColor('foreground');
  const mutedForeground = opacity(foreground, 0.5);
  return (
    <Log name="SearchTip">
      <HStack spacing={0} align="center">
        <Icon name={icon} size={20} color={mutedForeground} />
        <Text className="flex-1 pl-2" size={14} color={mutedForeground}>
          {text}
        </Text>
      </HStack>
    </Log>
  );
}
