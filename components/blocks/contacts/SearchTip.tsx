import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useThemeColor } from 'hooks/useThemeColor';

interface SearchTipProps {
  icon: string;
  text: string;
}

export function SearchTip({ icon, text }: SearchTipProps) {
  const foreground = useThemeColor('foreground');
  const mutedForeground = opacity(foreground, 0.5);
  return (
    <HStack spacing={0} align="center">
      <Icon name={icon} size={20} color={mutedForeground} />
      <Text className="flex-1 pl-2" size={14} overpass regular color={mutedForeground}>
        {text}
      </Text>
    </HStack>
  );
}
