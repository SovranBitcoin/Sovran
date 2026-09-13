import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { err, ok } from 'neverthrow';
import { MintReviewsScreen } from '@/features/mint/screens/MintReviewsScreen';
import { RatingBarChart } from '@/features/mint/components/RatingBarChart';
import { reviewMint, type MintRecommendation } from '@/shared/lib/apiClient';
import { formatRelative } from '@/shared/lib/date';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { mintReviewsCache } from '@/features/mint/data/mintReviewsCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/shared/lib/apiClient', () => ({ reviewMint: jest.fn() }));
// No data layer in Jest: the facade path falls back to the REST seam mocked above.
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: () => null }));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({
  useRouteParams: () => ({ mintUrl: 'https://mint.example.com' }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@/shared/hooks/useIdentityName', () => ({
  useIdentityName: () => ({ displayName: 'Example reviewer' }),
}));
jest.mock('@/shared/lib/date', () => ({ formatRelative: jest.fn(() => '2d') }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'rgb(128, 128, 128)') : 'rgb(128, 128, 128)',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/logger', () => ({
  ...jest.requireActual('@/shared/lib/logger'),
  useLifecycleLogger: jest.fn(),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View' },
  useSharedValue: (initial: number) => {
    let value = initial;
    return { get: () => value, set: (next: number) => (value = next) };
  },
  useAnimatedStyle: (style: () => object) => style(),
  withTiming: (value: number) => value,
  withDelay: (_delay: number, value: number) => value,
  Easing: { out: (value: unknown) => value, cubic: jest.fn() },
}));
jest.mock('@/shared/ui/composed/AnimatedCountValue', () => ({ useCountRollIn: () => ({}) }));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: ({
    loading,
    renderSkeleton,
    renderContent,
  }: {
    loading: boolean;
    renderSkeleton: () => React.ReactNode;
    renderContent: () => React.ReactNode;
  }) => (loading ? renderSkeleton() : renderContent()),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: () => null }));
jest.mock('@/assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('heroui-native', () => ({ PressableFeedback: 'Pressable' }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'View' }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: 'ButtonHandler' }));
// Deterministic content mounting; native virtualization is outside this test.
jest.mock('@/shared/ui/composed/List', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    List: ({
      data,
      renderItem,
      ListHeaderComponent,
      ListFooterComponent,
      ListEmptyComponent,
    }: {
      data: MintRecommendation[];
      renderItem: (info: { item: MintRecommendation }) => React.ReactNode;
      ListHeaderComponent: React.ReactNode;
      ListFooterComponent: React.ReactNode;
      ListEmptyComponent: React.ReactNode;
    }) => (
      <>
        {ListHeaderComponent}
        {data.length
          ? data.map((item) => (
              <React.Fragment key={item.eventId}>{renderItem({ item })}</React.Fragment>
            ))
          : ListEmptyComponent}
        {ListFooterComponent}
      </>
    ),
  };
});

// Same mint and aggregate fixture used by mintMetadataStore/mintCatalogCache tests.
const MINT = 'https://mint.example.com';
const review: MintRecommendation = {
  pubkey: 'a'.repeat(64),
  eventId: 'b'.repeat(64),
  score: 4,
  comment: 'Recommended',
  created_at: 1789070400,
};
const response = (recommendations: MintRecommendation[] = []) =>
  ok({
    mintUrl: MINT,
    score: recommendations.length ? 4.2 : null,
    recommendations,
    lastUpdated: null,
    fromCache: false,
  });
let renderer: TestRenderer.ReactTestRenderer;
async function renderScreen() {
  await act(async () => {
    renderer = TestRenderer.create(<MintReviewsScreen />);
  });
}
function textContent() {
  return renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join(' ');
}
function hosts(testID: string) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (node.props.testID === testID || node.props['data-testid'] === testID)
  );
}
function seedAggregate(favouriteCount?: number) {
  useMintMetadataStore.getState().setReviewsAggregate(MINT, 4.2, 7);
  useMintMetadataStore.getState().mergeCached(MINT, { favouriteCount }, ['reviews']);
}
beforeEach(() => {
  jest.clearAllMocks();
  mintReviewsCache.clear();
  useMintMetadataStore.setState({ byMintUrl: {} });
  jest.mocked(reviewMint).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it('shows the shared chart and cached favourites while fresh rows are loading', async () => {
  seedAggregate(3);
  await renderScreen();
  expect(hosts('mint-reviews-summary')).toHaveLength(1);
  expect(textContent()).toContain('7 reviews · 3 favourites');
  expect(renderer.root.findByType(RatingBarChart).props.score).toBe(4.2);
  expect(textContent()).not.toContain("Couldn't load");
  expect(hosts('mint-reviews-empty')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ state: 'loading', size: 44 })).toHaveLength(3);
});
it.each([0, undefined])('omits favourites when the count is %s', async (count) => {
  seedAggregate(count);
  await renderScreen();
  expect(textContent()).toContain('7 reviews');
  expect(textContent()).not.toContain('favourite');
});
it('shows aggregate placeholders on a cold open', async () => {
  await renderScreen();
  const summary = hosts('mint-reviews-summary')[0];
  expect(summary.findByProps({ placeholder: '0 reviews · 0 favourites' }).props.loading).toBe(true);
  expect(hosts('mint-reviews-empty')).toHaveLength(0);
});
it('shows the shared empty state after a successful empty response', async () => {
  jest.mocked(reviewMint).mockResolvedValue(response());
  await renderScreen();
  expect(hosts('mint-reviews-empty')).toHaveLength(1);
  expect(textContent()).toContain('No reviews yet');
  expect(textContent()).toContain('Be the first to share your experience.');
  expect(renderer.root.findAllByType(RatingBarChart)).toHaveLength(0);
});
it('renders event identity and compact dates, and serves a re-open from the session cache', async () => {
  jest.mocked(reviewMint).mockResolvedValue(response([review]));
  await renderScreen();
  expect(hosts(`mint-reviews-row-${review.eventId}`)).toHaveLength(1);
  expect(hosts(`mint-reviews-profile-${review.eventId}`)).toHaveLength(1);
  expect(textContent()).toContain('Recommended');
  expect(formatRelative).toHaveBeenCalledWith(review.created_at! * 1000, 'compact');
  // Rows never reach the durable store; only the aggregate does.
  expect(useMintMetadataStore.getState().getCached(MINT)).not.toHaveProperty('recommendations');
  expect(useMintMetadataStore.getState().getCached(MINT)?.reviewCount).toBe(1);
  act(() => renderer.unmount());
  // Fresh in the session cache: paints the same rows with no second round-trip.
  jest.mocked(reviewMint).mockImplementation(() => new Promise(() => {}));
  await renderScreen();
  expect(hosts(`mint-reviews-row-${review.eventId}`)).toHaveLength(1);
  expect(renderer.root.findAllByProps({ state: 'loading', size: 44 })).toHaveLength(0);
  expect(reviewMint).toHaveBeenCalledTimes(1);
});
it('keeps the aggregate on failure without claiming there are no reviews, and offers a retry', async () => {
  seedAggregate(3);
  jest.mocked(reviewMint).mockResolvedValue(err(new Error('offline')));
  await renderScreen();
  expect(textContent()).toContain('7 reviews · 3 favourites');
  expect(textContent()).toContain("Couldn't load reviews right now.");
  expect(hosts('mint-reviews-empty')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ state: 'loading' })).toHaveLength(0);
  const retry = renderer.root.findByProps({ testID: 'mint-reviews-retry' });
  jest.mocked(reviewMint).mockResolvedValue(response([review]));
  await act(async () => {
    retry.props.onPress();
  });
  expect(reviewMint).toHaveBeenCalledTimes(2);
  expect(hosts(`mint-reviews-row-${review.eventId}`)).toHaveLength(1);
});
it('shows a load failure when a cold request fails', async () => {
  jest.mocked(reviewMint).mockRejectedValue(new Error('offline'));
  await renderScreen();
  expect(textContent()).toContain("Couldn't load reviews right now.");
  expect(hosts('mint-reviews-empty')).toHaveLength(0);
});

it('renders scoreless endorsements without a zero-star rating', async () => {
  jest
    .mocked(reviewMint)
    .mockResolvedValue(ok({ ...response().value, recommendations: [{ ...review, score: null }] }));
  await renderScreen();
  expect(hosts(`mint-reviews-row-${review.eventId}`)).toHaveLength(1);
  expect(textContent()).toContain('Recommended');
  expect(renderer.root.findAllByProps({ accessibilityLabel: '0 out of 5 stars' })).toHaveLength(0);
  expect(renderer.root.findAllByType(RatingBarChart)).toHaveLength(0);
});

it('aborts an unfinished fetch on unmount and writes nothing from its late result', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof reviewMint>>) => void;
  jest.mocked(reviewMint).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await renderScreen();
  const signal = jest.mocked(reviewMint).mock.calls[0][0].signal;
  act(() => renderer.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    resolve(response([review]));
  });
  // Neither the durable aggregate nor the session rows: an aborted run is
  // never written (generation guard), so the next open fetches again.
  expect(useMintMetadataStore.getState().getCached(MINT)).toBeUndefined();
  expect(mintReviewsCache.getEntry(`reviews:${MINT}`)).toBeUndefined();
  await renderScreen();
  expect(reviewMint).toHaveBeenCalledTimes(2);
});
