import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { HStack } from '@/shared/ui/primitives/View/HStack';

/** The chart's rating levels and individual review scores share the same glyphs. */
export function RatingStars({
  score,
  count = 5,
  size = 16,
}: {
  score: number;
  count?: number;
  size?: number;
}) {
  const [defaultColor, starColor] = useThemeColor(['default', 'yellow-300'] as const);
  const filledStars = Math.round(score);

  return (
    <HStack className="shrink-0 gap-0.5">
      {Array.from({ length: count }, (_, index) => (
        <Icon
          key={index}
          name="ic:round-star"
          size={size}
          color={index < filledStars ? starColor : defaultColor}
        />
      ))}
    </HStack>
  );
}
