import { Screen } from '@/shared/ui/composed/Screen';
import { useEffect } from 'react';
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
import type { MintRecommendation, MintReviewsResponse } from '@/shared/lib/apiClient';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';
import {
  useCachedMintMetadata,
  useMintMetadataStore,
} from '@/shared/stores/global/mintMetadataStore';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { mintReviewsCache, mintReviewsKey } from '@/features/mint/data/mintReviewsCache';
import { Button } from '@/shared/ui/primitives/Button';
import { useIdentityName } from '@/shared/hooks/useIdentityName';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { RatingBarChart } from '@/features/mint/components/RatingBarChart';
import { RatingStars } from '@/features/mint/components/RatingStars';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { List } from '@/shared/ui/composed/List';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
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
          // The real glyph row at the real size, dimmed — identical height, so
          // the row cannot shift when the score lands.
          <View className="opacity-25">
            <RatingStars score={0} size={14} />
          </View>
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
            // Two wrapped lines at phone width — the typical comment length —
            // so the placeholder reserves what a real review usually needs.
            placeholder="Fast swaps and reliable so far, no issues receiving or sending over a few weeks of daily use."
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

  // Review ROWS live in the session-only reviews cache (never persisted); a
  // re-opened screen paints them at 0ms and revalidates once they are stale.
  // The AGGREGATE (score + count) is durable in the unified metadata cache so
  // the header survives a failed row fetch and paints on a warm open.
  const meta = useCachedMintMetadata(mintUrl);
  const kymScore = meta?.averageScore ?? null;
  const aggregateCount = meta?.reviewCount;
  useEffect(() => {
    if (!mintUrl) cashuLog.warn('mint.reviews.fetch.skipped', { reason: 'missing_mint_url' });
  }, [mintUrl]);

  const read = useCachedRead<MintReviewsResponse>({
    store: mintReviewsCache,
    surface: 'mintReviews',
    key: mintUrl ? mintReviewsKey(mintUrl) : null,
    viewerKey: '',
    fetcher: async ({ signal, readId }) => {
      const result = await fetchMintReviews({ mintUrl: mintUrl ?? '', signal, readId });
      if (result.isErr()) throw result.error;
      if (signal?.aborted) return { data: result.value };
      // Always overwrite the aggregate with the fresh successful result (even
      // a null score / empty list) so a stale aggregate can't outlive the source.
      useMintMetadataStore
        .getState()
        .setReviewsAggregate(
          mintUrl ?? '',
          result.value.score,
          result.value.recommendations.length
        );
      return { data: result.value };
    },
  });

  const isLoading = !mintUrl ? false : read.status === 'loading';
  const loadFailed = !mintUrl || (!!read.error && !read.data);
  const reviews = sortReviews(read.data?.recommendations ?? []);
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

  // Footer-only skeletons on a cold open (nothing cached yet): the real reviews
  // populate the list body, so there's no in-place content to fade into. Route
  // through the canonical helper for the region wave; `exit="none"` lets them
  // unmount as the list fills. A revalidation keeps the cached rows instead.
  const skeletonCount = 3;
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
    <VStack className="mt-6 items-center gap-3 px-8">
      <Text size={14} className="text-foreground/50 text-center">
        Couldn&apos;t load reviews right now.
      </Text>
      {mintUrl ? (
        <Button
          testID="mint-reviews-retry"
          text="Try again"
          variant="secondary"
          size="compact"
          onPress={read.refresh}
        />
      ) : null}
    </VStack>
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
