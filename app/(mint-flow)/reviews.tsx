/**
 * @fileoverview Mint Reviews Modal Screen
 *
 * Displays all reviews/recommendations for a mint with pagination.
 * Uses KYM (Know Your Mint) data to show user reviews and ratings.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import Icon from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { useKYMMint } from 'hooks/coco/useKYMMint';
import { getUsername } from 'helper/username';
import { Skeleton } from 'components/ui/Skeleton';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';

// ============================================================================
// Star Rating Component
// ============================================================================
const StarRating = React.memo(function StarRating({
  score,
  size = 16,
}: {
  score: number;
  size?: number;
}) {
  const { getPrimaryColor, getYellowColor } = useTheme();
  const filledStars = Math.round(score);

  return (
    <HStack gap={2}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Icon
          key={i}
          name="ic:round-star"
          size={size}
          color={i < filledStars ? getYellowColor('300') : getPrimaryColor('600')}
        />
      ))}
    </HStack>
  );
});

// ============================================================================
// Review Item Component
// ============================================================================
const ReviewItem = React.memo(function ReviewItem({
  review,
  isLast,
}: {
  review: any;
  isLast: boolean;
}) {
  const { getPrimaryColor } = useTheme();

  // Extract review data
  const reviewText = review.comment?.split(']')[1] || review.comment;
  const reviewScore = review.score ?? 0;
  const displayName = getUsername(review.pubkey);

  // Format date if available
  const formattedDate = review.created_at
    ? new Date(review.created_at * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <View style={styles.reviewItem}>
      <HStack align="flex-start" gap={12} style={{ flex: 1 }}>
        {/* Avatar */}
        <View style={{ flexShrink: 0 }}>
          <Avatar seed={review.pubkey} name={displayName} size={48} variant="person" />
        </View>

        {/* Review content */}
        <VStack spacing={6} style={{ flex: 1, minWidth: 0 }}>
          {/* User name and date */}
          <HStack align="center" justify="space-between" style={{ flex: 1 }}>
            <Text
              size={15}
              bold
              style={{ color: getPrimaryColor('0'), flex: 1 }}
              numberOfLines={1}
              ellipsizeMode="tail">
              {displayName}
            </Text>
            {formattedDate && (
              <Text size={12} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
                {formattedDate}
              </Text>
            )}
          </HStack>

          {/* Star rating */}
          <StarRating score={reviewScore} size={16} />

          {/* Review text */}
          {reviewText && (
            <Text
              size={14}
              style={{ color: opacity(getPrimaryColor('0'), 0.66), lineHeight: 20 }}
              numberOfLines={10}>
              {reviewText.trim()}
            </Text>
          )}
        </VStack>
      </HStack>

      {/* Divider */}
      {!isLast && <View style={[styles.divider, { backgroundColor: getPrimaryColor('800') }]} />}
    </View>
  );
});

// ============================================================================
// Loading Skeleton - Matches ReviewItem layout
// ============================================================================
const ReviewSkeleton = React.memo(function ReviewSkeleton({
  isLast = false,
}: {
  isLast?: boolean;
}) {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={styles.reviewItem}>
      <HStack align="flex-start" gap={12} style={{ flex: 1 }}>
        {/* Avatar skeleton */}
        <View style={{ flexShrink: 0 }}>
          <Skeleton
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: getPrimaryColor('800'),
            }}
          />
        </View>

        {/* Content skeleton */}
        <VStack spacing={6} style={{ flex: 1, minWidth: 0 }}>
          {/* Name and date row */}
          <HStack align="center" justify="space-between" style={{ flex: 1 }}>
            <Skeleton
              style={{
                width: 120,
                height: 15,
                borderRadius: 4,
                backgroundColor: getPrimaryColor('800'),
              }}
            />
            <Skeleton
              style={{
                width: 70,
                height: 12,
                borderRadius: 4,
                backgroundColor: getPrimaryColor('800'),
              }}
            />
          </HStack>

          {/* Star rating skeleton */}
          <HStack gap={2}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 2,
                  backgroundColor: getPrimaryColor('800'),
                }}
              />
            ))}
          </HStack>

          {/* Review text skeleton */}
          <VStack spacing={4}>
            <Skeleton
              style={{
                width: '100%',
                height: 14,
                borderRadius: 4,
                backgroundColor: getPrimaryColor('800'),
              }}
            />
            <Skeleton
              style={{
                width: '80%',
                height: 14,
                borderRadius: 4,
                backgroundColor: getPrimaryColor('800'),
              }}
            />
          </VStack>
        </VStack>
      </HStack>

      {/* Divider */}
      {!isLast && <View style={[styles.divider, { backgroundColor: getPrimaryColor('800') }]} />}
    </View>
  );
});

// ============================================================================
// Empty State
// ============================================================================
const EmptyState = React.memo(function EmptyState() {
  const { getPrimaryColor, getYellowColor } = useTheme();

  return (
    <VStack align="center" justify="center" style={styles.emptyState}>
      <Icon name="ic:round-star" size={64} color={getYellowColor('500')} />
      <Spacer size={16} />
      <Text size={18} bold style={{ color: getPrimaryColor('0'), textAlign: 'center' }}>
        No Reviews Yet
      </Text>
      <Spacer size={8} />
      <Text
        size={14}
        style={{
          color: opacity(getPrimaryColor('0'), 0.4),
          textAlign: 'center',
          paddingHorizontal: 32,
        }}>
        This mint has not received any reviews yet. Be the first to share your experience!
      </Text>
    </VStack>
  );
});

// ============================================================================
// Header Stats
// ============================================================================
const HeaderStats = React.memo(function HeaderStats({
  score,
  totalReviews,
  loading,
}: {
  score: number | null;
  totalReviews: number;
  loading: boolean;
}) {
  const { getPrimaryColor, getYellowColor } = useTheme();

  const displayScore = score !== null ? score.toFixed(1) : '0.0';
  const hasScore = score !== null && score >= 0;

  return (
    <View style={styles.headerStats}>
      <VStack align="center" spacing={4}>
        {/* Large score */}
        {loading && !hasScore ? (
          <Skeleton
            style={{
              width: 80,
              height: 48,
              borderRadius: 8,
              backgroundColor: getPrimaryColor('800'),
            }}
          />
        ) : (
          <Text heavy size={48} style={{ color: getYellowColor('300'), lineHeight: 52 }}>
            {displayScore}
          </Text>
        )}

        {/* Star rating */}
        {loading && !hasScore ? (
          <HStack gap={4}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: getPrimaryColor('800'),
                }}
              />
            ))}
          </HStack>
        ) : hasScore ? (
          <StarRating score={score} size={24} />
        ) : null}

        {/* Review count */}
        {loading && totalReviews === 0 ? (
          <Skeleton
            style={{
              width: 80,
              height: 14,
              borderRadius: 4,
              marginTop: 4,
              backgroundColor: getPrimaryColor('800'),
            }}
          />
        ) : (
          <Text size={14} style={{ color: opacity(getPrimaryColor('0'), 0.4), marginTop: 4 }}>
            {totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}
          </Text>
        )}
      </VStack>
    </View>
  );
});

// ============================================================================
// Main Component
// ============================================================================
function MintReviewsModal() {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { mintUrl } = useLocalSearchParams<{ mintUrl: string }>();

  // Fetch KYM data
  const {
    score: kymScore,
    recommendations: kymRecommendations,
    loading: kymLoading,
  } = useKYMMint(mintUrl || '');

  // Timeout fallback - if loading takes more than 5 seconds, consider done
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (kymLoading) {
        console.log('⏱️ Reviews loading timeout');
        setTimedOut(true);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [kymLoading]);

  // Consider loading if KYM is loading AND we haven't timed out
  const isLoading = kymLoading && !timedOut;

  // Memoize recommendations list
  const reviews = useMemo(() => kymRecommendations || [], [kymRecommendations]);
  const totalReviews = reviews.length;

  // Render item - reviews show as they come in
  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <ReviewItem review={item} isLast={!isLoading && index === reviews.length - 1} />
    ),
    [reviews.length, isLoading]
  );

  // Key extractor
  const keyExtractor = useCallback(
    (item: any, index: number) => item.pubkey || `review-${index}`,
    []
  );

  // List header
  const ListHeader = useMemo(
    () => <HeaderStats score={kymScore ?? null} totalReviews={totalReviews} loading={isLoading} />,
    [kymScore, totalReviews, isLoading]
  );

  // List footer - show skeletons while loading
  const ListFooter = useMemo(() => {
    if (!isLoading) return null;
    // Show fewer skeletons if we already have some reviews
    const skeletonCount = reviews.length > 0 ? 2 : 3;
    return (
      <View>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ReviewSkeleton key={`skeleton-${i}`} isLast={i === skeletonCount - 1} />
        ))}
      </View>
    );
  }, [isLoading, reviews.length]);

  // Show empty state only when done loading and no reviews
  const showEmptyState = !isLoading && totalReviews === 0;

  return (
    <View style={[styles.container, { backgroundColor: getPrimaryColor('950') }]}>
      <Stack.Screen options={{ title: 'Reviews' }} />

      {showEmptyState ? (
        <View style={[styles.content, { paddingTop: insets.top + 48 }]}>
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
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: insets.top + 48, paddingBottom: 120 },
          ]}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  headerStats: {
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: 'center',
  },
  reviewItem: {
    paddingVertical: 16,
  },
  divider: {
    height: 1,
    marginTop: 16,
  },
  emptyState: {
    flex: 1,
    paddingVertical: 48,
  },
});

export default withSheetProvider(MintReviewsModal);
