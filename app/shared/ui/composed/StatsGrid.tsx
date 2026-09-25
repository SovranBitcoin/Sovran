import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Text } from '@/shared/ui/primitives/Text';

/**
 * Four measured facts about a counterparty, two by two.
 *
 * The shape a details page uses when the numbers ARE the assessment: a mint's
 * audit record, a provider's catalog and what you can spend there. Four cards
 * because two is a pair of headlines and six is a table — at four the eye
 * takes the grid in one pass and the two on top can be bigger than the two
 * below without the block turning into a ranking.
 *
 * Extracted from `MintInfoScreen`, which had it inline, at the point the
 * provider page needed the same block. Two counterparty pages that answer the
 * same question — "who is this, and can I use them?" — should not be assembled
 * out of different parts.
 *
 * The grid is ALWAYS the same chrome, loading or not: only the text inside the
 * cards swaps for skeleton bars, under a crossfade. A block that unmounts
 * while it waits is a block that shoves everything below it down the moment it
 * arrives.
 */

/** Unknown counts render as a dash, never as a zero that reads as measured
 *  (hunch rule ui/unknown-values). */
export const UNKNOWN_STAT = '—';

export interface GridStat {
  /** Rendered upper-case. Known before the data is, so its own text is the
   *  skeleton's width. */
  label: string;
  /** The line under the number, saying what it counts. */
  description: string;
  value: string;
  /** Bigger type. Reserve it for the two that decide the page. */
  accent?: boolean;
  /** A typical value, for the skeleton bar's width. The value itself is the
   *  one thing genuinely unknown while loading, so it is the one thing that
   *  cannot size its own placeholder. */
  placeholder: string;
}

export function StatsGrid({
  stats,
  loading,
  visualKey,
  visualSurface,
  testID,
  accessibilityLabel,
}: {
  /** Four of them. Rendered two per row, in order. */
  stats: readonly GridStat[];
  loading: boolean;
  visualKey: string;
  visualSurface: string;
  testID?: string;
  accessibilityLabel?: string;
}) {
  // The surface colour is passed to the crossfade as a value, and the two
  // label tints are alpha over the foreground — neither is expressible as a
  // class, and every other dimension here is.
  const [foreground, surfaceSecondary] = useThemeColor(['foreground', 'surface-secondary']);

  const renderGrid = (skeleton: boolean) => (
    // Negative gutter so the cards' own padding produces the gap between them
    // without the outer edges inheriting it.
    <View className="-mx-1.5 w-full self-stretch">
      {[0, 2].map((rowStart) => (
        <View key={rowStart} className="w-full flex-row">
          {stats.slice(rowStart, rowStart + 2).map((stat) => (
            <View key={stat.label} className="flex-1 p-1.5">
              <View className="bg-surface-secondary border-surface-tertiary flex-1 rounded-xl border p-4">
                <Text
                  loading={skeleton}
                  placeholder={stat.label.toUpperCase()}
                  bold
                  size={12}
                  color={withAlpha(foreground, 0.66)}
                  className="mb-1">
                  {stat.label.toUpperCase()}
                </Text>
                <Text
                  loading={skeleton}
                  placeholder={stat.placeholder}
                  bold
                  size={stat.accent ? 24 : 20}
                  color={foreground}
                  className="mb-0.5">
                  {stat.value}
                </Text>
                <Text
                  loading={skeleton}
                  placeholder={stat.description}
                  bold
                  size={12}
                  color={withAlpha(foreground, 0.5)}
                  className="opacity-80">
                  {stat.description}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <View
      className="mt-4 w-full self-stretch"
      testID={testID}
      accessibilityLabel={accessibilityLabel}>
      <SkeletonContentCrossfade
        loading={loading}
        surfaceColor={surfaceSecondary}
        visualKey={visualKey}
        visualSurface={visualSurface}
        renderSkeleton={() => renderGrid(true)}
        renderContent={() => renderGrid(false)}
      />
    </View>
  );
}
