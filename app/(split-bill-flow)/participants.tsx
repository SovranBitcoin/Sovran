/**
 * @fileoverview Split-Bill — Step 2: pick who pays.
 *
 * Multi-select picker aggregating 3 data sources (BLE, Nostr recents, self)
 * via `useSplitBillParticipantPicker`. Sections render inside
 * `SectionAnchorList` — a horizontal anchor bar lets the user tap-to-scroll
 * between "Your Accounts" / "Bluetooth" / "Recent", and the receive-amount
 * `HistoryEntryHeader` sits transparently above the list with a gradient
 * fade behind it so rows taper as they scroll past.
 *
 * The bottom bar (selected pills + Next button) floats with its own
 * `ScrollEdgeFade` so list content also fades behind the bar. The Next
 * button's label carries the live per-person split math
 * (`Next · 5 × $20`) so we don't need a separate caption for it.
 *
 * "Next" seeds a `draft` SplitBillGroup in the store and navigates to
 * `summary` — actual invoice generation + delivery happens there.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import opacity from 'hex-color-opacity';

import { useSplitBillPickerContext } from './_layout';
import { type PickerCandidate } from '@/features/splitBill/hooks/useSplitBillParticipantPicker';
import { ParticipantRow } from '@/features/splitBill/components/ParticipantRow';
import { useSplitBillTransactionsStore } from '@/shared/stores/profile/splitBillTransactionsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { LiquidGlassText } from 'liquid-glass-text';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { ScrollEdgeFade } from '@/shared/ui/composed/ScrollEdgeFade';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { SectionAnchorList, type AnchorSection } from '@/shared/ui/composed/SectionAnchorList';
import { HistoryEntryHeader } from '@/features/transactions';
import Icon from 'assets/icons';
import { Screen, useLifecycleLogger, useRenderLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

const BLUETOOTH_ACCENT = '#0A84FF';

/** Small soft-entry region above the measured bar top. Rows entering this
 *  band begin fading before they ever reach the pills, so the top of the
 *  bar doesn't appear to have a hard edge against the list. */
const TAPER_ABOVE_BAR = 40;

/** Opaque backstop at the very bottom of the fade region, behind the Next
 *  button. Everything above this band — including the pills — sits over
 *  the gradient taper, so list rows visibly fade out as they scroll up
 *  behind the pills instead of cutting off at the pills' top edge. */
const OPAQUE_BOTTOM_BAND = 70;

/** Visible avatar size inside the stack (px). Drives the negative margin
 *  used for overlap + the cut-out ring thickness. */
const STACK_AVATAR_SIZE = 24;

/** Negative margin between overlapping avatars. ~40% overlap reads clearly
 *  as "stacked" without hiding too much of each face. */
const STACK_AVATAR_OVERLAP = 10;

export default function SplitBillParticipantsScreen() {
  useLifecycleLogger('SplitBillParticipantsScreen', walletLog);
  useRenderLogger('SplitBillParticipantsScreen', 120, walletLog);
  const router = useRouter();
  const { totalAmount: totalAmountStr, unit: unitParam } = useLocalSearchParams<{
    totalAmount?: string;
    unit?: string;
  }>();
  const totalAmount = parseInt(totalAmountStr ?? '0', 10) || 0;
  const unit = (unitParam as string) || 'sat';

  const [foreground, background, surfaceSecondary] = useThemeColor([
    'foreground',
    'background',
    'surface-secondary',
  ] as const);
  const headerHeight = useHeaderHeight();

  // Measured height of the floating BottomButtons region. Drives the
  // list's bottom padding + the bottom ScrollEdgeFade's position.
  const [bottomBarHeight, setBottomBarHeight] = useState(120);
  const handleBottomBarLayout = useCallback((event: LayoutChangeEvent) => {
    const h = event.nativeEvent.layout.height;
    setBottomBarHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  // Shared picker state — instance hosted in the parent `_layout.tsx` so
  // the search modal route sees the same selection.
  const picker = useSplitBillPickerContext();
  const { sections, selected, selectedIds, toggle } = picker;

  const { keys: nostrKeys } = useNostrKeysContext();
  const activeMintUrl = useMintStore((s) =>
    nostrKeys?.pubkey ? s.selectedMints[nostrKeys.pubkey] : undefined
  );
  const startGroup = useSplitBillTransactionsStore((s) => s.startGroup);

  // Toggle wrapper — instruments latency so logs show the gap between
  // user press and committed selection. Must stay referentially stable
  // across renders: `ParticipantRow` is memoized on `onToggle`, and a
  // new callback identity every render would defeat the memo and force
  // every row to reconcile on every tap. `selectedIds` is read through
  // a ref so the log stays accurate without tripping the dep list.
  const togglePressAt = useRef<number | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const instrumentedToggle = useCallback(
    (candidate: PickerCandidate) => {
      togglePressAt.current = performance.now();
      walletLog.debug('split_bill.participants.toggle_press', {
        id: candidate.id,
        source: candidate.source,
        wasSelected: selectedIdsRef.current.has(candidate.id),
      });
      toggle(candidate);
    },
    [toggle]
  );

  useEffect(() => {
    if (togglePressAt.current !== null) {
      const latency = Math.round((performance.now() - togglePressAt.current) * 100) / 100;
      walletLog.debug('split_bill.participants.toggle_commit', {
        selectedCount: selected.length,
        latency_ms: latency,
      });
      togglePressAt.current = null;
    }
  }, [selectedIds, selected.length]);

  const prevSectionSig = useRef<string>('');
  useEffect(() => {
    const sig = sections.map((s) => `${s.title}:${s.data.length}`).join('|');
    if (sig !== prevSectionSig.current) {
      walletLog.debug('split_bill.participants.sections_changed', {
        sig,
        total: sections.reduce((n, s) => n + s.data.length, 0),
      });
      prevSectionSig.current = sig;
    }
  }, [sections]);

  const perPerson = useMemo(() => {
    if (selected.length === 0) return 0;
    return Math.floor(totalAmount / selected.length);
  }, [totalAmount, selected.length]);

  const remainder = useMemo(() => {
    if (selected.length === 0) return 0;
    return totalAmount - perPerson * selected.length;
  }, [totalAmount, perPerson, selected.length]);

  const canProceed = selected.length > 0 && perPerson > 0 && !!activeMintUrl;

  // Next-button label — consolidates the per-person split math
  // ("Next · 5 × $20"). The amount goes through the real
  // `AmountFormatter` primitive (MonaSans, unit-aware glyph, honours
  // the user's Bitcoin display preference, Apple Liquid Glass text when
  // supported). The "×" uses the same Liquid Glass path via `GlassText`
  // so the math pair reads as one native-typography group, while
  // "Next · 5" stays in the OxygenBold button font as the label prefix.
  const nextLabel = useMemo<string | React.ReactNode>(() => {
    if (selected.length === 0 || perPerson <= 0) return 'Next';
    return (
      <HStack align="center" spacing={4}>
        <Text size={14} style={{ fontFamily: 'OxygenBold', color: background }}>
          {`Next · ${selected.length}`}
        </Text>
        <GlassText text="×" fontFamily="MonaSans-Black" fontSize={14} color={background} />
        <AmountFormatter
          amount={perPerson}
          unit={unit}
          size={14}
          weight="heavy"
          color={background}
          liquid
          glassVariant="clear"
        />
      </HStack>
    );
  }, [selected.length, perPerson, unit, background]);

  const handleNext = useCallback(async () => {
    if (!canProceed || !activeMintUrl) return;
    const group = startGroup({
      unit,
      mintUrl: activeMintUrl,
      totalAmount,
      participants: selected.map((c, idx) => ({
        source: c.source,
        channel: c.channel,
        pubkey: c.pubkey,
        peerID: c.peerID,
        nickname: c.nickname,
        avatarUrl: c.avatarUrl,
        amount: idx === 0 ? perPerson + remainder : perPerson,
      })),
    });
    walletLog.info('split_bill.participants.next', {
      groupId: group.id,
      participants: selected.length,
      totalAmount,
      perPerson,
    });
    router.push({
      pathname: '/(split-bill-flow)/summary' as any,
      params: { groupId: group.id },
    });
  }, [
    canProceed,
    activeMintUrl,
    startGroup,
    unit,
    totalAmount,
    selected,
    perPerson,
    remainder,
    router,
  ]);

  // Map the picker hook's `sections` into the AnchorSection shape the
  // SectionAnchorList consumes. Each section carries a stable `id`, an
  // anchor pill (icon + label) visible in the top bar, and a
  // `renderHeader` that emits the existing uppercase-muted section title.
  const anchorSections = useMemo<AnchorSection<PickerCandidate>[]>(() => {
    return sections.map((s) => {
      const id = s.title.toLowerCase().replace(/\s+/g, '-');
      const icon = anchorIconFor(s.title, foreground);
      return {
        id,
        anchor: {
          icon,
          label: s.title,
          testID: `split-bill-anchor-${id}`,
        },
        data: s.data,
        renderHeader: () => (
          <Text size={13} heavy style={[styles.sectionHeader, { color: opacity(foreground, 0.4) }]}>
            {s.title.toUpperCase()}
          </Text>
        ),
      };
    });
  }, [sections, foreground]);

  // Closure over `selectedIds` is intentional — it flips renderItem's
  // identity on every selection change so SectionAnchorList walks its
  // items and feeds each the current `selected` value. The memoed
  // `ParticipantRow` skips render on every row whose (candidate, selected,
  // onToggle) tuple is referentially equal, so only the toggled row
  // actually re-renders.
  const renderItem = useCallback(
    (item: PickerCandidate) => (
      <ParticipantRow
        candidate={item}
        selected={selectedIds.has(item.id)}
        onToggle={instrumentedToggle}
      />
    ),
    [selectedIds, instrumentedToggle]
  );

  const keyExtractor = useCallback((item: PickerCandidate) => item.id, []);

  // Empty state (no sections → no candidates). Rendered via
  // `overrideContent` so it takes the whole scroll area instead of just
  // the ListEmptyComponent slot.
  const emptyOverride = useMemo(() => {
    if (anchorSections.length > 0) return null;
    return (
      <VStack align="center" spacing={8} style={styles.emptyBlock}>
        <Icon name="mdi:account-group" size={32} color={opacity(foreground, 0.3)} />
        <Text size={14} style={{ color: opacity(foreground, 0.5), textAlign: 'center' }}>
          No Bluetooth peers or recent contacts. Tap the search icon above to find anyone on Nostr.
        </Text>
      </VStack>
    );
  }, [anchorSections.length, foreground]);

  return (
    <Screen name="SplitBillParticipantsScreen" style={{ flex: 1, backgroundColor: background }}>
      <Stack.Screen
        options={{
          title: 'Who Pays',
          headerRight: () => (
            <Pressable
              testID="split-bill-participants-search"
              onPress={() => router.push('/(split-bill-flow)/search' as any)}
              hitSlop={8}
              style={{ paddingHorizontal: 8 }}>
              <Icon name="mdi:magnify" size={22} color={foreground} />
            </Pressable>
          ),
        }}
      />
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        <SectionAnchorList<PickerCandidate>
          sections={anchorSections}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          aboveAnchors={
            <HistoryEntryHeader pendingData={{ amount: totalAmount, unit, type: 'receive' }} />
          }
          overrideContent={emptyOverride}
          contentBottomInset={bottomBarHeight + TAPER_ABOVE_BAR}
          topFadeColor={background}
          anchorBarStyle={styles.anchorBarInset}
        />
      </View>

      {/* Bottom gradient + bar — rows fade into opaque surface behind the
          floating pills + Next button. Same shape as before: a tall
          fade with a fixed OPAQUE band sized to the Next button, plus
          a taper reaching into the list. */}
      <ScrollEdgeFade
        edge="bottom"
        height={bottomBarHeight + TAPER_ABOVE_BAR}
        fadeSize={Math.max(
          bottomBarHeight + TAPER_ABOVE_BAR - OPAQUE_BOTTOM_BAND,
          (bottomBarHeight + TAPER_ABOVE_BAR) / 2
        )}
        zIndex={1}
      />

      <BottomButtons style={{ zIndex: 2 }} paddingBottom={16} onLayout={handleBottomBarLayout}>
        {selected.length > 0 && (
          <View style={styles.pillsRow}>
            <SelectedPreviewPill
              selected={selected}
              foreground={foreground}
              surfaceSecondary={surfaceSecondary}
            />
            {selected.length > 1 && (
              <Text size={13} style={{ color: opacity(foreground, 0.6), marginLeft: 4 }}>
                and {selected.length - 1} more
              </Text>
            )}
          </View>
        )}
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                testID: 'split-bill-participants-next',
                text: nextLabel,
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                disabled: !canProceed,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </Screen>
  );
}

interface GlassTextProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
}

/**
 * Inline Liquid Glass text with a hidden RN Text driving layout.
 *
 * `LiquidGlassText`'s native `intrinsicContentSize` doesn't reliably
 * propagate to Yoga when the view sits inline in an HStack — adjacent
 * glass nodes end up overlapping because Yoga measures them at zero
 * width. This helper renders an invisible RN Text with the same content
 * + font to provide the Yoga measurement, then overlays the glass view
 * via `StyleSheet.absoluteFill`. On iOS < 26 / Android the backing Text
 * is promoted to visible and the overlay is skipped.
 */
function GlassText({ text, fontFamily, fontSize, color }: GlassTextProps) {
  if (!supportsLiquidGlass()) {
    return (
      <Text size={fontSize} allowFontScaling={false} style={{ fontFamily, color }}>
        {text}
      </Text>
    );
  }
  return (
    <View>
      <Text size={fontSize} allowFontScaling={false} style={{ fontFamily, color: 'transparent' }}>
        {text}
      </Text>
      <LiquidGlassText
        text={text}
        fontName={fontFamily}
        fontSize={fontSize}
        tint={color}
        glassVariant="clear"
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      />
    </View>
  );
}

/** Return the small icon that sits to the left of the anchor pill label. */
function anchorIconFor(title: string, foreground: string) {
  const t = title.toLowerCase();
  if (t.includes('bluetooth')) {
    return <Icon name="mdi:bluetooth" size={14} color={BLUETOOTH_ACCENT} />;
  }
  if (t.includes('account')) {
    return <Icon name="mdi:account-circle" size={14} color={opacity(foreground, 0.7)} />;
  }
  if (t.includes('recent')) {
    return <Icon name="mdi:clock-outline" size={14} color={opacity(foreground, 0.7)} />;
  }
  return <Icon name="mdi:account-group" size={14} color={opacity(foreground, 0.7)} />;
}

interface SelectedPreviewPillProps {
  selected: PickerCandidate[];
  foreground: string;
  surfaceSecondary: string;
}

const SelectedPreviewPill = React.memo(function SelectedPreviewPill({
  selected,
  foreground,
  surfaceSecondary,
}: SelectedPreviewPillProps) {
  const named = selected[selected.length - 1];
  const label = named.nickname ?? named.pubkey?.slice(0, 8) ?? named.peerID?.slice(0, 8) ?? '?';

  const ringSize = STACK_AVATAR_SIZE + 4;
  const ringRadius = ringSize / 2;

  return (
    <View style={[styles.pill, { backgroundColor: surfaceSecondary }]}>
      <HStack align="center" spacing={6}>
        <View style={styles.avatarStack}>
          {selected.map((c, idx) => (
            <View
              key={c.id}
              style={{
                width: ringSize,
                height: ringSize,
                borderRadius: ringRadius,
                backgroundColor: surfaceSecondary,
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: idx === 0 ? 0 : -STACK_AVATAR_OVERLAP,
                zIndex: idx,
              }}>
              {c.source === 'ble' ? (
                <View
                  style={[styles.bleAvatar, { backgroundColor: opacity(BLUETOOTH_ACCENT, 0.18) }]}>
                  <Icon name="mdi:bluetooth" size={14} color={BLUETOOTH_ACCENT} />
                </View>
              ) : (
                <Avatar
                  state={c.avatarUrl ? 'image' : 'fallback'}
                  picture={c.avatarUrl}
                  name={c.nickname}
                  seed={c.pubkey}
                  size={STACK_AVATAR_SIZE}
                />
              )}
            </View>
          ))}
        </View>
        <Text size={13} bold numberOfLines={1} style={styles.pillLabel} color={foreground}>
          {label}
        </Text>
      </HStack>
    </View>
  );
});

const styles = StyleSheet.create({
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pill: {
    paddingLeft: 2,
    paddingRight: 10,
    paddingVertical: 2,
    borderRadius: 20,
  },
  pillLabel: {
    maxWidth: 120,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bleAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  anchorBarInset: {
    paddingLeft: 20,
    paddingTop: 20,
  },
  emptyBlock: {
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
});
