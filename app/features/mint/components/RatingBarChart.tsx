import { useEffect, useRef } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { RatingStars } from './RatingStars';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCountRollIn } from '@/shared/ui/composed/AnimatedCountValue';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';

/** Shared average-score display; the bars represent rating levels, not review counts. */
export function RatingBarChart({
  score,
  visualSurface = 'mint-info',
}: {
  score: number;
  visualSurface?: 'mint-info' | 'mint-reviews';
}) {
  const starColor = useThemeColor('yellow-300');

  const fadeAnim = useSharedValue(0);
  const barScaleAnim = useSharedValue(0);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.get(), alignItems: 'center' }));
  const starFadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.get() }));
  const barFillStyle = useAnimatedStyle(() => ({
    width: '100%',
    height: '100%',
    borderRadius: 4,
    transform: [{ scaleX: barScaleAnim.get() }],
    transformOrigin: 'left center',
  }));

  const isValidScore = score >= 0;
  const showSkeleton = !isValidScore;

  const targetRow = isValidScore ? Math.max(1, Math.min(5, Math.ceil(score))) : 0;
  const goldPercentage = isValidScore && targetRow > 0 ? Math.min(1, score / targetRow) : 0;

  const formattedScore = isValidScore ? score.toFixed(1) : '0.0';
  // Rolls the headline score when a background refresh replaces the cached one
  // (the bar-fill reveal below stays a one-shot mount-entrance animation).
  const scoreRoll = useCountRollIn(formattedScore);

  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (isValidScore && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;

      fadeAnim.set(0);
      barScaleAnim.set(0);

      fadeAnim.set(withTiming(1, { duration: 400 }));
      barScaleAnim.set(
        withDelay(
          200,
          withTiming(goldPercentage, { duration: 800, easing: Easing.out(Easing.cubic) })
        )
      );
    }
  }, [isValidScore, goldPercentage, fadeAnim, barScaleAnim]);

  // Placeholders are the same Text at the same sizes (loading bars sized by a
  // hidden glyph run), so the skeleton and the populated chart share one height.
  const renderSkeleton = () => (
    <HStack className="w-full items-center gap-4 self-stretch px-4">
      <VStack className="shrink-0 items-center">
        <Text heavy size={28} loading placeholder="4.7" className="text-foreground" />
        <Text size={12} loading placeholder="out of 5" className="text-foreground/50" />
      </VStack>
      <VStack className="min-w-0 flex-1 gap-1">
        {[5, 4, 3, 2, 1].map((stars) => (
          <HStack key={stars} className="w-full min-w-0 items-center gap-0.5">
            <RatingStars score={0} count={stars} size={12} />
            <View className="bg-surface-tertiary h-2 min-w-6 flex-1 rounded" />
          </HStack>
        ))}
      </VStack>
    </HStack>
  );

  const renderContent = () => (
    <HStack className="w-full items-center gap-4 self-stretch px-4">
      <VStack className="shrink-0 items-center">
        <Animated.View style={fadeStyle}>
          <Animated.View style={scoreRoll}>
            <Text heavy size={28} className="text-foreground">
              {formattedScore}
            </Text>
          </Animated.View>
          <Text size={12} className="text-foreground/50">
            out of 5
          </Text>
        </Animated.View>
      </VStack>

      <VStack className="min-w-0 flex-1 gap-1">
        {[5, 4, 3, 2, 1].map((stars) => {
          const isTargetRow = stars === targetRow;
          return (
            <HStack key={stars} className="w-full min-w-0 items-center gap-0.5">
              {isTargetRow ? (
                <Animated.View style={starFadeStyle}>
                  <RatingStars score={stars} count={stars} size={12} />
                </Animated.View>
              ) : (
                <RatingStars score={0} count={stars} size={12} />
              )}
              <View className="bg-surface-tertiary h-2 min-w-6 flex-1 overflow-hidden rounded">
                {isTargetRow && (
                  <Animated.View style={[barFillStyle, { backgroundColor: starColor }]} />
                )}
              </View>
            </HStack>
          );
        })}
      </VStack>
    </HStack>
  );

  return (
    <SkeletonContentCrossfade
      loading={showSkeleton}
      visualKey={`${visualSurface}-rating`}
      visualSurface={visualSurface}
      renderSkeleton={renderSkeleton}
      renderContent={renderContent}
    />
  );
}
