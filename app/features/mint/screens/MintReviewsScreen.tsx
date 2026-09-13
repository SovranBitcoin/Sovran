import { Screen } from '@/shared/ui/composed/Screen';
import { useState, useEffect } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { reviewMint, type MintRecommendation } from '@/shared/lib/apiClient';
import {
  useCachedMintMetadata,
  useMintMetadataStore,
} from '@/shared/stores/global/mintMetadataStore';
import { useIdentityName } from '@/shared/hooks/useIdentityName';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { RatingBarChart } from '@/features/mint/components/RatingBarChart';
import { RatingStars } from '@/features/mint/components/RatingStars';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { List } from '@/shared/ui/composed/List';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cashuLog, redactError, useLifecycleLogger, mintUrlLogFields } from '@/shared/lib/logger';
import { formatRelative } from '@/shared/lib/date';

/** Commented reviews first, each group newest-first. */
function sortReviews(rawReviews: MintRecommendation[]): MintRecommendation[] {
  const withContent = rawReviews.filter((r) => r.comment?.trim());
  const withoutContent = rawReviews.filter((r) => !r.comment?.trim());
  const byDate = (a: MintRecommendation, b: MintRecommendation) =>
    (b.created_at ?? 0) - (a.created_at ?? 0);
  return [...withContent.sort(byDate), ...withoutContent.sort(byDate)];
}

const keyExtractor = (item: MintRecommendation) => item.eventId;

const ParamsSchema = z.object({
  mintUrl: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^https?:\/\//, 'mintUrl must be http(s)'),
});

/** Shared shell keeps loading placeholders aligned with the populated row. */
function ReviewRow({
  review,
  displayName,
  loading = false,
}: {
  review?: MintRecommendation;
  displayName?: string;
  loading?: boolean;
}) {
  const picture = review?.picture ?? review?.image;
  const avatar = (
    <Avatar
      state={loading ? 'loading' : picture ? 'image' : 'fallback'}
      picture={picture}
      seed={review?.pubkey}
      name={displayName}
      size={44}
    />
  );
  const reviewText = review?.comment?.trim() ?? '';
  const formattedDate = review?.created_at
    ? formatRelative(review.created_at * 1000, 'compact')
    : null;

  return (
    <ListRow
      testID={review ? `mint-reviews-row-${review.eventId}` : undefined}
      paddingHorizontal={0}
      leading={
        review ? (
          <Pressable
            testID={`mint-reviews-profile-${review.eventId}`}
            accessibilityRole="button"
            accessibilityLabel={`Open ${displayName} profile`}
            activeOpacity={0.75}
            className="shrink-0"
            haptics
            onPress={() => router.push(buildModalProfileHref({ pubkey: review.pubkey }))}>
            {avatar}
          </Pressable>
        ) : (
          avatar
        )
      }
      title={
        <HStack className="items-center justify-between gap-2">
          <Text
            loading={loading}
            placeholder="Display name"
            size={16}
            bold
            className="text-foreground min-w-0 flex-1"
            numberOfLines={1}
            ellipsizeMode="tail">
            {displayName}
          </Text>
          {(loading || formattedDate) && (
            <Text
              loading={loading}
              placeholder="2d"
              size={12}
              className="text-foreground/50 shrink-0">
              {formattedDate}
            </Text>
          )}
        </HStack>
      }
      subtitle={
        loading ? (
          <HStack className="gap-0.5">
            {[0, 1, 2, 3, 4].map((star) => (
              <Skeleton key={star} className="bg-surface-secondary h-3.5 w-3.5 rounded-sm" />
            ))}
          </HStack>
        ) : review?.score != null ? (
          <View accessible accessibilityLabel={`${review.score} out of 5 stars`}>
            <RatingStars score={review.score} size={14} />
          </View>
        ) : undefined
      }
      accent={
        loading || reviewText ? (
          <Text
            loading={loading}
            placeholder="Share your experience with this mint."
            size={14}
            className="text-foreground/60 leading-5"
            numberOfLines={10}>
            {reviewText}
          </Text>
        ) : undefined
      }
    />
  );
}

function ReviewItem({ review }: { review: MintRecommendation }) {
  const { displayName: fallbackDisplayName } = useIdentityName(review.pubkey);
  return (
    <ReviewRow
      review={review}
      displayName={review.displayName ?? review.name ?? fallbackDisplayName}
    />
  );
}

export function MintReviewsScreen() {
  useLifecycleLogger('MintReviewsScreen');
  const background = useThemeColor('surface');
  const insets = useSafeAreaInsets();
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.reviews' });
  const mintUrl = params?.mintUrl;

  const [kymLoading, setKymLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Review ROWS are ephemeral — fetched fresh on every open, never persisted
  // (the raw list is "junk to store forever"). Only the AGGREGATE (score +
  // count) is durable, read from the unified cache so it survives a failed
  // fetch and paints the header immediately on a warm open.
  const [rawReviews, setRawReviews] = useState<MintRecommendation[]>([]);
  const meta = useCachedMintMetadata(mintUrl);
  const kymScore = meta?.averageScore ?? null;
  const aggregateCount = meta?.reviewCount;

  useEffect(() => {
    if (!mintUrl) {
      cashuLog.warn('mint.reviews.fetch.skipped', { reason: 'missing_mint_url' });
      setKymLoading(false);
      setLoadFailed(true);
      return;
    }
    const cachedAtStart = useMintMetadataStore.getState().getCached(mintUrl);
    setKymLoading(true);
    setLoadFailed(false);
    setRawReviews([]);
    // Always fetch fresh review rows from server. Abort on unmount or if mintUrl
    // changes mid-flight so a slow fetch doesn't write into a stale screen.
    const controller = new AbortController();
    cashuLog.info('mint.reviews.fetch.start', {
      ...mintUrlLogFields(mintUrl),
      hasCachedAggregate: !!cachedAtStart?.reviewsAt,
      cachedScore: cachedAtStart?.averageScore ?? null,
      cachedReviewCount: cachedAtStart?.reviewCount ?? 0,
    });
    reviewMint({ mintUrl, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          cashuLog.debug('mint.reviews.fetch.stale', {
            ...mintUrlLogFields(mintUrl),
            reason: 'aborted_before_result',
          });
          return;
        }
        cashuLog.info('mint.reviews.fetch.result', {
          ...mintUrlLogFields(mintUrl),
          ok: result.isOk(),
          hasScore: result.isOk() && result.value.score !== null,
          recommendationCount: result.isOk() ? result.value.recommendations.length : 0,
        });
        // Rows → local state (ephemeral); aggregate → durable cache. Always
        // overwrite with the fresh successful result (even a null score / empty
        // list) so a stale aggregate can't outlive the source. (audit F3)
        setLoadFailed(result.isErr());
        if (result.isOk()) {
          setRawReviews(result.value.recommendations);
          useMintMetadataStore
            .getState()
            .setReviewsAggregate(mintUrl, result.value.score, result.value.recommendations.length);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        // On failure the cached aggregate header stays visible; only the row
        // list falls back to its empty/last-known state.
        cashuLog.warn('mint.reviews.fetch.failed', {
          ...mintUrlLogFields(mintUrl),
          error: redactError(error),
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setKymLoading(false);
      });
    return () => {
      cashuLog.debug('mint.reviews.fetch.abort', { ...mintUrlLogFields(mintUrl) });
      controller.abort();
    };
  }, [mintUrl]);

  const isLoading = kymLoading;
  const reviews = sortReviews(rawReviews);
  // Header count prefers the durable aggregate (survives a failed row fetch),
  // falling back to the freshly-fetched rows before the first aggregate lands.
  const totalReviews = aggregateCount ?? reviews.length;

  const renderItem = ({ item }: { item: MintRecommendation }) => <ReviewItem review={item} />;
  const aggregateLoading = isLoading && !meta?.reviewsAt;
  const favouriteCount = meta?.favouriteCount ?? 0;
  const reviewsLabel = `${totalReviews} ${totalReviews === 1 ? 'review' : 'reviews'}`;
  const favouritesLabel =
    favouriteCount > 0
      ? ` · ${favouriteCount} ${favouriteCount === 1 ? 'favourite' : 'favourites'}`
      : '';

  const ListHeader = (
    <VStack testID="mint-reviews-summary" className="gap-3 pb-6 pt-4">
      {(aggregateLoading || kymScore !== null) && (
        <RatingBarChart key={mintUrl} score={kymScore ?? -1} visualSurface="mint-reviews" />
      )}
      <Text
        loading={aggregateLoading}
        placeholder="0 reviews · 0 favourites"
        size={14}
        className="text-foreground/50 text-center">
        {reviewsLabel + favouritesLabel}
      </Text>
    </VStack>
  );

  // Footer-only skeletons: the real reviews populate the list body, so there's
  // no in-place content to fade into. Route through the canonical helper for
  // the region wave; `exit="none"` lets them unmount as the list fills.
  const skeletonCount = reviews.length > 0 ? 2 : 3;
  const ListFooter = isLoading ? (
    <SkeletonContentCrossfade
      loading
      exit="none"
      visualKey="mint-reviews-list"
      visualSurface="mint-reviews"
      renderSkeleton={() => (
        <View>
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <ReviewRow key={`skeleton-${i}`} loading />
          ))}
        </View>
      )}
      renderContent={() => null}
    />
  ) : null;

  const showEmptyState = !isLoading && !loadFailed && reviews.length === 0;

  // A failed fetch is distinct from a confirmed empty result, even on a cold open.
  const listEmpty = !isLoading ? (
    <Text size={14} className="text-foreground/50 mt-6 px-8 text-center">
      Couldn&apos;t load reviews right now. Reopen to try again.
    </Text>
  ) : null;

  return (
    <Screen
      name="MintReviewsScreen"
      scroll="custom"
      bgColor={background}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                testID: 'mint-reviews-close',
                text: 'Close',
                variant: 'secondary',
                onPress: async () => router.back(),
              },
            ]}
          />
        </BottomButtons>
      }>
      <Stack.Screen options={{ title: 'Reviews' }} />

      <List
        screen
        data={reviews}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={showEmptyState ? null : ListFooter}
        ListEmptyComponent={
          showEmptyState ? (
            <View testID="mint-reviews-empty">
              <EmptyState
                icon="ic:round-star"
                title="No reviews yet"
                subtitle="Be the first to share your experience."
              />
            </View>
          ) : (
            listEmpty
          )
        }
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 48,
        }}
      />
    </Screen>
  );
}
