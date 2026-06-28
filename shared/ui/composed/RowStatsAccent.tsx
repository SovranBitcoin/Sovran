/**
 * @fileoverview `RowStatsAccent` — icon + value pills for the `accent` slot of
 * `ListRow`.
 *
 * Collapses the bespoke stats layout previously inlined in each row
 * component into one primitive so rows with reputation data read the same
 * across the app — same spacing, same bullet separator, same
 * icon-next-to-number visual rhythm.
 *
 * Shape:  [<icon> value] • [<icon> value] • [<check> handle…]  [optional note]
 *
 * The optional NIP-05 pill at the end takes remaining width and truncates
 * with ellipsis — short stat icons read first, the handle fits whatever
 * space is left.
 *
 * Returns `null` when there's nothing to render, so callers can pass it
 * unconditionally and let `ListRow` omit the third line automatically.
 *
 * Consumers own the color palette: follower counts are blue, scores are
 * warning-tinted, etc. The `STAT_ICONS` constant below names the canonical
 * iconify glyphs so every caller picks the same icon for the same semantic.
 */

import React from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useCountRollIn } from '@/shared/ui/composed/AnimatedCountValue';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

/** Canonical iconify glyphs for row-accent stats. Use these names so a star
 *  is a star everywhere, an account-group is followers everywhere, etc. */
export const STAT_ICONS = {
  /** Reputation / KYM score. Tint: theme `warning`. */
  score: 'ic:round-star',
  /** Follower count (people following this pubkey). Tint:
   *  `STAT_COLOR_SOCIAL` (theme blue-300) across the app. */
  followers: 'mdi:account-group',
  /** Contact-reputation badge (distinct from score). Tint:
   *  `STAT_COLOR_SOCIAL`. */
  reputation: 'mdi:shield-check',
  /** Audit / activity signal. Tint: theme `success` or `STAT_COLOR_ERROR` on error. */
  audit: 'lucide:activity',
  /** Works-offline indicator. Tint: theme `success`. */
  offline: 'mdi:airplane',
  /** NIP-05 verification badge. Rendered next to a handle in the trailing
   *  pill of the accent row; always tinted `STAT_COLOR_SOCIAL` (blue) to
   *  match the rest of the nostr-sourced stats. Server-side `nip05Valid`
   *  is too noisy (cache misses, transient `/.well-known/nostr.json`
   *  fetch failures) to gate color on, and conflicts are already
   *  filtered out of search results upstream. */
  nip05: 'mdi:check-decagram',
} as const;

/** Theme blue-300 — shared tint for social / identity stats. Mirrors the
 *  design-system blue ramp (Apple-blue hue at green-matched saturation). */
export const STAT_COLOR_SOCIAL = '#2A7AD0';

/** Theme red-300 (Tailwind red-500) — shared tint for audit/error states.
 *  Mirrors the design-system red ramp. */
export const STAT_COLOR_ERROR = '#EF4444';

export interface RowStat {
  /** iconify name. Prefer a value from `STAT_ICONS` to stay on-palette. */
  icon: string;
  /** Short display string, e.g. "1.2k", "45", "85%". */
  value: string;
  /** Muted parenthetical suffix for paired values — e.g. `★ 4.5 (23)` where
   *  `23` is a review count behind the 4.5 score. Renders in the same tint
   *  at 70% opacity, tight against `value`. */
  meta?: string;
  /** Tint applied to both icon and value text. */
  color: string;
  /** Optional a11y description for the icon/value pair. */
  accessibilityLabel?: string;
}

interface RowStatsAccentProps {
  stats: RowStat[];
  /** Animate each stat value with the feed roll-in when it changes (cached→fresh).
   *  Off by default so non-mint rows stay byte-identical. The caller MUST key
   *  this element by a stable identity (e.g. mintUrl) so a recycled list cell
   *  remounts the pills instead of rolling a neighbour's value. */
  animate?: boolean;
  /** Trailing note appended below the stats (e.g. a disabled reason). */
  note?: string;
  /** Color for the note text. Defaults to a dim foreground. */
  noteColor?: string;
  /** Optional NIP-05 pill rendered as the last entry on the stats line:
   *  `[stats] • <check> handle@relay.example.com` (truncated with ellipsis
   *  to fit remaining width). Always tinted `STAT_COLOR_SOCIAL` (blue) —
   *  see `STAT_ICONS.nip05` for why we don't gate on a validity flag.
   *  Absent `handle` → pill is omitted. */
  nip05?: { handle: string };
}

/**
 * One icon + value stat pill. Each pill owns a single `useCountRollIn` instance
 * (keyed by the parent on `stat.icon`, the stable semantic) so the hook count is
 * constant as the stat set grows/shrinks. When `animate` is set, the value rolls
 * in on change; otherwise the plain `Text` renders unchanged.
 */
function RowStatPill({ stat, animate }: { stat: RowStat; animate?: boolean }) {
  // Hook is always called (rules-of-hooks); `animate` only decides the wrapper.
  const rollIn = useCountRollIn(`${stat.value}|${stat.meta ?? ''}`);
  const inner = (
    <Text size={12} bold color={stat.color}>
      {stat.value}
      {stat.meta ? (
        <Text size={12} color={opacity(stat.color, 0.7)}>
          {' ('}
          {stat.meta}
          {')'}
        </Text>
      ) : null}
    </Text>
  );
  return (
    <HStack align="center" style={{ gap: 3 }} accessibilityLabel={stat.accessibilityLabel}>
      <Icon name={stat.icon} size={12} color={stat.color} />
      {animate ? <Animated.View style={rollIn}>{inner}</Animated.View> : inner}
    </HStack>
  );
}

export function RowStatsAccent({ stats, note, noteColor, nip05, animate }: RowStatsAccentProps) {
  const [foreground] = useThemeColor(['foreground'] as const);

  const hasNip05 = !!nip05?.handle;
  if (stats.length === 0 && !note && !hasNip05) return null;

  const resolvedNoteColor = noteColor ?? opacity(foreground, 0.6);
  const hasStatsOrNip05 = stats.length > 0 || hasNip05;

  return (
    <>
      {hasStatsOrNip05 && (
        <HStack align="center" style={{ gap: 4, marginTop: 2 }}>
          {stats.map((stat, i) => (
            <React.Fragment key={`${stat.icon}-${i}`}>
              {i > 0 && (
                <Text size={9} color={opacity(foreground, 0.15)}>
                  {'•'}
                </Text>
              )}
              <RowStatPill stat={stat} animate={animate} />
            </React.Fragment>
          ))}
          {hasNip05 ? (
            <>
              {stats.length > 0 && (
                <Text size={9} color={opacity(foreground, 0.15)}>
                  {'•'}
                </Text>
              )}
              <View
                style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 }}
                accessibilityLabel={`Verified ${nip05!.handle}`}>
                <Icon name={STAT_ICONS.nip05} size={12} color={STAT_COLOR_SOCIAL} />
                <Text
                  size={12}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  color={STAT_COLOR_SOCIAL}
                  style={{ flexShrink: 1 }}>
                  {nip05!.handle}
                </Text>
              </View>
            </>
          ) : null}
        </HStack>
      )}
      {note ? (
        <Text size={12} color={resolvedNoteColor}>
          {note}
        </Text>
      ) : null}
    </>
  );
}

/**
 * Loading placeholder for the accent line. Rendered by `ContactRow` while a
 * stats-bearing row (e.g. a mint result) is loading, so the accent's height is
 * reserved and the row doesn't grow when the real `RowStatsAccent` pills arrive.
 *
 * Co-located with `RowStatsAccent` so the geometry can't drift: it mirrors the
 * real pill's structure exactly — the same outer `HStack` (`gap: 4, marginTop:
 * 2`) and per-pill `HStack` (`gap: 3`) of a 12px icon box + a `Text` at the
 * same `size`/`bold`. The `Text loading` bar self-sizes to the real 12px line
 * box, so the accent line is the same height whether loading or loaded (a fixed
 * pixel bar previously under-shot the text line height by a couple of pixels).
 */
export function RowStatsAccentSkeleton({ seed }: { seed?: string }) {
  const foreground = useThemeColor('foreground');
  // Plain disc filled with the same low-opacity foreground tint that `Text`,
  // `Avatar`, and `MintIcon` loading placeholders use — NOT the darker
  // `bg-skeleton` token (nor its own `animate-pulse`, which those siblings lack)
  // — so every skeleton element in a row reads as one consistent shade and the
  // shared crossfade wave is the only motion.
  const dotColor = opacity(foreground, 0.07);
  return (
    <HStack align="center" style={{ gap: 4, marginTop: 2 }}>
      {[`accent:${seed ?? 'x'}`, `accent2:${seed ?? 'x'}`].map((key, i) => (
        <HStack key={key} align="center" style={{ gap: 3 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dotColor }} />
          <Text size={12} bold loading placeholder={i === 0 ? '4.5' : '98%'} />
        </HStack>
      ))}
    </HStack>
  );
}
