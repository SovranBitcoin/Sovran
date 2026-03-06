import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { FlatList } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { useKYMMint } from '@/features/mint/hooks/useKYMMint';
import { getUsername } from '@/shared/lib/username';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';

const StarRating = React.memo(function StarRating({
  score,
  size = 16,
}: {
  score: number;
  size?: number;
}) {
  const [defaultColor, warning] = useThemeColor(['default', 'yellow-300'] as const);
  const filledStars = Math.round(score);

  return (
    <HStack gap={2}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Icon
          key={i}
          name="ic:round-star"
          size={size}
          color={i < filledStars ? warning : defaultColor}
        />
      ))}
    </HStack>
  );
});

const ReviewItem = React.memo(function ReviewItem({
  review,
  isLast,
}: {
  review: any;
  isLast: boolean;
}) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const reviewText = review.comment?.split(']')[1] || review.comment;
  const reviewScore = review.score ?? 0;
  const displayName = getUsername(review.pubkey);

  const formattedDate = review.created_at
    ? new Date(review.created_at * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <View className="py-4">
      <HStack align="flex-start" gap={12} className="flex-1">
        <View className="shrink-0">
          <Avatar seed={review.pubkey} name={displayName} size={48} />
        </View>

        <VStack spacing={6} className="min-w-0 flex-1">
          <HStack align="center" justify="space-between" className="flex-1">
            <Text
              size={15}
              bold
              className="flex-1"
              style={{ color: foreground }}
              numberOfLines={1}
              ellipsizeMode="tail">
              {displayName}
            </Text>
            {formattedDate && (
              <Text size={12} style={{ color: opacity(foreground, 0.4) }}>
                {formattedDate}
              </Text>
            )}
          </HStack>

          <StarRating score={reviewScore} size={16} />

          {reviewText && (
            <Text
              size={14}
              style={{ color: opacity(foreground, 0.66), lineHeight: 20 }}
              numberOfLines={10}>
              {reviewText.trim()}
            </Text>
          )}
        </VStack>
      </HStack>

      {!isLast && <View className="mt-4 h-px" style={{ backgroundColor: surfaceSecondary }} />}
    </View>
  );
});

const ReviewSkeleton = React.memo(function ReviewSkeleton({
  isLast = false,
}: {
  isLast?: boolean;
}) {
  const surfaceSecondary = useThemeColor('surface-secondary');

  return (
    <View className="py-4">
      <HStack align="flex-start" gap={12} className="flex-1">
        <View className="shrink-0">
          <Skeleton
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: surfaceSecondary,
            }}
          />
        </View>

        <VStack spacing={6} className="min-w-0 flex-1">
          <HStack align="center" justify="space-between" className="flex-1">
            <Skeleton
              style={{
                width: 120,
                height: 15,
                borderRadius: 4,
                backgroundColor: surfaceSecondary,
              }}
            />
            <Skeleton
              style={{
                width: 70,
                height: 12,
                borderRadius: 4,
                backgroundColor: surfaceSecondary,
              }}
            />
          </HStack>

          <HStack gap={2}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 2,
                  backgroundColor: surfaceSecondary,
                }}
              />
            ))}
          </HStack>

          <VStack spacing={4}>
            <Skeleton
              style={{
                width: '100%',
                height: 14,
                borderRadius: 4,
                backgroundColor: surfaceSecondary,
              }}
            />
            <Skeleton
              style={{
                width: '80%',
                height: 14,
                borderRadius: 4,
                backgroundColor: surfaceSecondary,
              }}
            />
          </VStack>
        </VStack>
      </HStack>

      {!isLast && <View className="mt-4 h-px" style={{ backgroundColor: surfaceSecondary }} />}
    </View>
  );
});

const EmptyState = React.memo(function EmptyState() {
  const [foreground, yellow500] = useThemeColor(['foreground', 'yellow-500'] as const);

  return (
    <VStack align="center" justify="center" className="flex-1 py-12">
      <Icon name="ic:round-star" size={64} color={yellow500} />
      <Spacer size={16} />
      <Text size={18} bold style={{ color: foreground, textAlign: 'center' }}>
        No Reviews Yet
      </Text>
      <Spacer size={8} />
      <Text
        size={14}
        style={{
          color: opacity(foreground, 0.4),
          textAlign: 'center',
          paddingHorizontal: 32,
        }}>
        This mint has not received any reviews yet. Be the first to share your experience!
      </Text>
    </VStack>
  );
});

const HeaderStats = React.memo(function HeaderStats({
  score,
  totalReviews,
  loading,
}: {
  score: number | null;
  totalReviews: number;
  loading: boolean;
}) {
  const [foreground, surfaceSecondary, warning] = useThemeColor([
    'foreground',
    'surface-secondary',
    'yellow-300',
  ] as const);

  const displayScore = score !== null ? score.toFixed(1) : '0.0';
  const hasScore = score !== null && score >= 0;

  return (
    <View className="items-center pb-6 pt-4">
      <VStack align="center" spacing={4}>
        <Text
          loading={loading && !hasScore}
          placeholder="0.0"
          heavy
          size={48}
          style={{ color: warning, lineHeight: 52 }}>
          {displayScore}
        </Text>

        {loading && !hasScore ? (
          <HStack gap={4}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: surfaceSecondary,
                }}
              />
            ))}
          </HStack>
        ) : hasScore ? (
          <StarRating score={score} size={24} />
        ) : null}

        <Text
          loading={loading && totalReviews === 0}
          placeholder="0 reviews"
          size={14}
          style={{ color: opacity(foreground, 0.4), marginTop: 4 }}>
          {totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}
        </Text>
      </VStack>
    </View>
  );
});

export function MintReviewsScreen() {
  const background = useThemeColor('background');
  const insets = useSafeAreaInsets();
  const { mintUrl } = useLocalSearchParams<{ mintUrl: string }>();

  const {
    score: kymScore,
    recommendations: kymRecommendations,
    loading: kymLoading,
  } = useKYMMint(mintUrl || '');

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (kymLoading) setTimedOut(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [kymLoading]);

  const isLoading = kymLoading && !timedOut;
  const reviews = useMemo(() => kymRecommendations || [], [kymRecommendations]);
  const totalReviews = reviews.length;

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <ReviewItem review={item} isLast={!isLoading && index === reviews.length - 1} />
    ),
    [reviews.length, isLoading]
  );

  const keyExtractor = useCallback(
    (item: any, index: number) => item.pubkey || `review-${index}`,
    []
  );

  const ListHeader = useMemo(
    () => <HeaderStats score={kymScore ?? null} totalReviews={totalReviews} loading={isLoading} />,
    [kymScore, totalReviews, isLoading]
  );

  const ListFooter = useMemo(() => {
    if (!isLoading) return null;
    const skeletonCount = reviews.length > 0 ? 2 : 3;
    return (
      <View>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ReviewSkeleton key={`skeleton-${i}`} isLast={i === skeletonCount - 1} />
        ))}
      </View>
    );
  }, [isLoading, reviews.length]);

  const showEmptyState = !isLoading && totalReviews === 0;

  return (
    <View className="flex-1" style={{ backgroundColor: background }}>
      <Stack.Screen options={{ title: 'Reviews' }} />

      {showEmptyState ? (
        <View className="flex-1 px-4" style={{ paddingTop: insets.top + 48 }}>
          {ListHeader}
          <EmptyState />
        </View>
      ) : (
        <FlatList
          data={reviews}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: insets.top + 48,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => router.back(),
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}
