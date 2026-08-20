import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';

/** Small retry/skip action pill shown under a failed rebalance hop. */
export function RebalanceActionPill({
  icon,
  label,
  onPress,
}: {
  icon: 'mdi:refresh' | 'mdi:skip-next';
  label: string;
  onPress: () => void;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Pressable onPress={onPress} haptics className="bg-surface-tertiary rounded-[6px] px-3 py-1.5">
      <HStack className="items-center gap-1">
        <Icon name={icon} size={14} color={foreground} />
        <Text bold size={12} className="text-foreground">
          {label}
        </Text>
      </HStack>
    </Pressable>
  );
}
