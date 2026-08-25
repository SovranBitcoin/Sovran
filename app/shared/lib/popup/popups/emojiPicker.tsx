/**
 * Imperative emoji picker — categories as scroll-to-section tabs, plus a
 * search field that flips the body to flat results. Visually identical to
 * the Select Profile menu (`actionMenuPopup` + sections), structurally
 * routed through `PopupHost`'s heroui `<BottomSheet>` so it can mount
 * inside iOS FullWindowOverlay (above route modals like Send Ecash).
 *
 * Why not `actionMenuPopup`: heroui `<Menu presentation="bottom-sheet">`
 * silently fails to mount inside FullWindowOverlay (verified via tracing —
 * the host receives `isOpen=true` but gorhom never snaps the sheet open).
 * Standalone heroui `<BottomSheet>` works fine in FWO, so emoji lives
 * here. The chrome below mirrors `ActionMenuHost`'s tabbed-menu recipe
 * 1:1 (title typography, search field, anchor bar padding, top fade
 * color, bottom inset) so the surface looks indistinguishable from
 * Select Profile.
 *
 * Usage:
 *   import { emojiPickerPopup } from '@/shared/lib/popup';
 *   emojiPickerPopup({ token: getEncodedTokenV4(myToken) });
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native';
import * as Clipboard from 'expo-clipboard';
import { withAlpha } from '@/shared/lib/color';
import { CurrencyIcon } from 'assets/icons';

import { encode } from '@/shared/lib/third-party/emoji';
import { log, useRenderLogger } from '@/shared/lib/logger';
import { AnimatedEmoji } from '@/shared/ui/primitives/AnimatedEmoji';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SectionAnchorList, type AnchorSection } from '@/shared/ui/composed/SectionAnchorList';
import { List } from '@/shared/ui/composed/List';
import { SheetSearchField } from '../SheetSearchField';

import { showActionSheet } from './bridge';
import { copyPopup } from './copy';
import { CATEGORIES, searchEmojis, type EmojiCategory, type EmojiEntry } from './emojiData';
import { emojiCodepointKey, emojiPickerOptionTestID } from './emojiPickerIds';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import type { CustomSheetSharedProps } from '../sheets/types';

const emojiLog = log.child({ module: 'emojiPicker' });

const COLS = 6;
const CELL_WIDTH_PCT = `${100 / COLS}%` as const;

/**
 * Single emoji cell. The list's row recycling must detect "same emoji +
 * same onSelect identity = same content" and skip the inner re-render —
 * with ~6 cells per row and dozens of rows recycled during a long
 * scroll, that skip is the difference between a smooth jump and a
 * multi-second JS-thread block. The React Compiler's element-identity
 * memoization provides it.
 *
 * `Pressable` instead of `TouchableOpacity` — TouchableOpacity wraps
 * an Animated.View + native gesture-responder setup per cell, which is
 * heavy at recycle time. `Pressable` defers the gesture handler until
 * first interaction. The press-in opacity dim is achieved via the
 * style callback so the visual feedback stays the same.
 */
function EmojiCell({ entry, onSelect }: { entry: EmojiEntry; onSelect: (emoji: string) => void }) {
  return (
    <Pressable
      testID={emojiPickerOptionTestID(entry.emoji)}
      onPress={() => onSelect(entry.emoji)}
      style={({ pressed }) => [styles.emojiCell, pressed && styles.emojiCellPressed]}>
      <Text style={styles.emojiText}>{entry.emoji}</Text>
    </Pressable>
  );
}

/**
 * Single virtualized row of emojis (up to `COLS` cells). List row
 * recycling skips the row's outer render when its `emojis` array
 * reference is stable (compiler element-identity memoization). Used
 * both as the per-row renderer for category sections inside
 * `SectionAnchorList` AND as the `renderItem` for the search-results
 * `List` override.
 */
function EmojiRow({
  emojis,
  onSelect,
}: {
  emojis: EmojiEntry[];
  onSelect: (emoji: string) => void;
}) {
  return (
    <View style={styles.row}>
      {emojis.map((entry) => (
        <EmojiCell key={entry.emoji} entry={entry} onSelect={onSelect} />
      ))}
    </View>
  );
}

/**
 * Chunk a flat emoji array into rows of `COLS` for virtualization. Used
 * by the search-results override path — sections come pre-chunked by
 * `SectionAnchorList`, but the override branch needs its own chunking
 * since it bypasses sections entirely.
 */
function chunkEmojis(emojis: EmojiEntry[]): EmojiEntry[][] {
  const rows: EmojiEntry[][] = [];
  for (let i = 0; i < emojis.length; i += COLS) {
    rows.push(emojis.slice(i, i + COLS));
  }
  return rows;
}

// Module-level stable callbacks. `keyExtractor` is used as a `useMemo`
// dep inside `SectionAnchorList`'s flatten step — passing an inline
// function was rebuilding the 228-row flat array on every parent
// re-render (verified via `sectionList.flatten` log frequency).
// `noop` covers the unused `renderItem` slot since this picker only
// uses the chunked `renderRow` path.
const emojiKeyExtractor = (item: EmojiEntry): string => item.emoji;
const noopRenderItem = (): null => null;

const searchRowKeyExtractor = (row: EmojiEntry[], index: number): string => {
  const rowKey = row
    .map((entry) => `${emojiCodepointKey(entry.emoji)}:${entry.keywords[0] ?? 'emoji'}`)
    .join('|');
  return rowKey.length > 0 ? rowKey : `search-row-${index}`;
};

// Each category becomes a virtualized section. `data` is the flat
// emoji array — `SectionAnchorList` chunks it into rows of `COLS`
// (passed via `rowChunkSize`) and only mounts the rows that fall
// inside the draw window. No `renderHeader` so the anchor pill is
// the section's only label, matching Select Profile semantics.
// Reads only module data, so it's built once at module scope.
const CATEGORY_SECTIONS: AnchorSection<EmojiEntry>[] = CATEGORIES.map((cat: EmojiCategory) => ({
  id: cat.id,
  anchor: {
    icon:
      cat.id === 'bitcoin' ? (
        <CurrencyIcon width={16} currency="sat" />
      ) : (
        <Text style={{ fontSize: 14 }}>{cat.icon}</Text>
      ),
    label: cat.label,
    testID: `emoji-tab-${cat.id}`,
  },
  data: cat.emojis,
}));

interface EmojiPickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['emoji-picker'];
}

/**
 * Body of the emoji-picker custom sheet, mounted by `PopupHost`'s
 * `CUSTOM_SHEET_CONTENT` registry. Owns the search state locally and
 * uses `SectionAnchorList` for the tabbed scroll — same primitive that
 * powers Select Profile's tabs in `ActionMenuHost`.
 */
export function EmojiPickerContent({
  payload,
  close,
  setFooterConfig,
  canPop,
  popCustomPage,
}: EmojiPickerContentProps) {
  // 30 is the warn threshold — the picker shouldn't re-render that
  // many times during normal use (search debounce + tab interactions
  // are the only state churn). Going over hints at parent-driven
  // re-renders or unstable callback identity.
  useRenderLogger('EmojiPickerContent', 30, emojiLog);

  const [foreground, overlay] = useThemeColor(['foreground', 'overlay'] as const);

  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearching = searchQuery.length > 0;

  // Time the substring search so a slow query (the dataset is ~1500
  // emojis) shows up in `slow` / `errors` modes. The search runs on
  // the JS thread so a >50ms hit blocks input handling.
  // ast-grep-ignore: no-manual-memo-tsx — the body logs a timing event
  // that must fire exactly once per query change; the explicit dep
  // array is the contract here, not an optimization.
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const start = Date.now();
    const results = searchEmojis(searchQuery);
    const elapsed = Date.now() - start;
    const level = elapsed > 50 ? 'warn' : 'debug';
    emojiLog[level]('emojiPicker.search.run', {
      query: searchQuery,
      queryLen: searchQuery.length,
      resultsCount: results.length,
      elapsedMs: elapsed,
    });
    return results;
  }, [isSearching, searchQuery]);

  // One-shot snapshot of how big the dataset is on this open cycle.
  // Helps correlate later `sectionList.flatten` events to the picker
  // payload — and confirms the categories list isn't unexpectedly
  // empty (which has happened in the past after data refactors).
  useEffect(() => {
    const totalEmojis = CATEGORIES.reduce((acc, c) => acc + c.emojis.length, 0);
    emojiLog.info('emojiPicker.mount', {
      categories: CATEGORIES.length,
      totalEmojis,
      cols: COLS,
      tokenLen: payload.token?.length ?? 0,
    });
    return () => emojiLog.info('emojiPicker.unmount', {});
    // Mount-only — we want a single record per open cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setFooterConfig(
      canPop ? { buttons: [{ label: 'Back', variant: 'tertiary', onPress: popCustomPage }] } : null
    );
    return () => setFooterConfig(null);
  }, [setFooterConfig, canPop, popCustomPage]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleEmojiSelect = async (emoji: string) => {
    emojiLog.info('emojiPicker.select', { emoji, fromSearch: searchQuery.length > 0 });
    const encodedEmoji = encode(emoji, payload.token);
    await Clipboard.setStringAsync(encodedEmoji);
    copyPopup('token', {
      onOpen: close,
      icon: <AnimatedEmoji emoji={emoji} size={28} />,
    });
  };

  const handleSearchChange = (text: string) => {
    setInputText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      emojiLog.debug('emojiPicker.search.debounced', { queryLen: text.length });
      setSearchQuery(text);
    }, 150);
  };

  const handleSearchClear = () => {
    emojiLog.debug('emojiPicker.search.clear', {});
    setInputText('');
    setSearchQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  // Pre-chunk search results so the override `List` virtualizes
  // per row (not per cell) — matches the rowChunkSize=6 layout of the
  // sectioned mode, so cells stay on the same x-grid as the search bar.
  const searchRows = chunkEmojis(searchResults);

  const renderEmojiRow = (items: EmojiEntry[]) => (
    <EmojiRow emojis={items} onSelect={handleEmojiSelect} />
  );
  const renderEmojiSearchRow = ({ item }: { item: EmojiEntry[] }) => (
    <EmojiRow emojis={item} onSelect={handleEmojiSelect} />
  );

  // `overrideContent` swaps the body wholesale. Empty search → centered
  // "No emoji found"; non-empty → its own virtualized `List` so the
  // override path stays cheap with hundreds of matches.
  const overrideContent = !isSearching ? null : searchResults.length === 0 ? (
    <View testID="emoji-picker-no-results" style={{ alignItems: 'center', paddingVertical: 32 }}>
      <Text style={{ color: withAlpha(foreground, 0.4), fontSize: 14 }}>No emoji found</Text>
    </View>
  ) : (
    <List<EmojiEntry[]>
      data={searchRows}
      keyExtractor={searchRowKeyExtractor}
      renderItem={renderEmojiSearchRow}
      // Match the SectionAnchorList draw window so search and
      // sectioned mode have the same buffer behavior on fast scroll.
      drawDistance={150}
      contentContainerClassName="pb-6"
      keyboardShouldPersistTaps="handled"
      renderScrollComponent={({ children, ...props }) => (
        <BottomSheetScrollView {...props}>{children}</BottomSheetScrollView>
      )}
    />
  );

  return (
    <SectionAnchorList<EmojiEntry>
      sections={CATEGORY_SECTIONS}
      // 6 emojis per row — `SectionAnchorList` chunks `data` into
      // `EmojiEntry[]` slices of this size and feeds each slice to
      // `renderRow`. The row, not the individual cell, is the
      // virtualization unit.
      rowChunkSize={COLS}
      renderRow={renderEmojiRow}
      renderItem={noopRenderItem}
      keyExtractor={emojiKeyExtractor}
      ScrollComponent={BottomSheetScrollView as never}
      overrideContent={overrideContent}
      // Tapers to `overlay` so the top fade matches the BottomSheet's
      // background (PopupHost sets `bg-overlay` on custom snapPoints
      // sheets — same token `<Menu.Content>` uses).
      topFadeColor={String(overlay)}
      // Pads the last row above the iOS home indicator. PopupHost's
      // `contentContainerClassName` is `'h-full px-0 pt-0 pb-0'` (no
      // safe-area padding on the wrapper) — same recipe as
      // `ActionMenuHost`'s tabbed-menu container, where the inset is
      // applied by the section list instead.
      contentBottomInset={24}
      anchorBarStyle={{ paddingHorizontal: 24 }}
      aboveAnchors={
        // Mirror `ActionMenuHost`'s chrome layout exactly. Wrapper at
        // `paddingHorizontal: 12` so the title's `ml-3` (12px) lands at
        // 24px from the sheet edge — same x-position as the anchor
        // bar's first pill (`anchorBarStyle.paddingHorizontal: 24`).
        // `BottomSheet.Title` is heroui's `<Menu.Label>` analogue —
        // both render through `TextComponentProvider`, so they look
        // identical.
        <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          <BottomSheet.Title className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
            Emoji
          </BottomSheet.Title>
          {/*
            `paddingHorizontal: 12` aligns the input's background edges with
            the first/last tab pill's outer edge: this parent sits at 12 and
            the anchor bar's first pill at 24, so 12 + 12 lines up exactly.
            It has to be an outer wrapper because SheetSearchField's own View
            is the clear button's containing block.
          */}
          <View style={{ marginTop: 8, paddingHorizontal: 12 }}>
            <SheetSearchField
              testID="emoji-picker-search"
              clearTestID="emoji-picker-search-clear"
              placeholder="Search emoji..."
              value={inputText}
              onChangeText={handleSearchChange}
              onClear={handleSearchClear}
            />
          </View>
        </View>
      }
    />
  );
}

export function emojiPickerPopup(payload: ActionSheetPayloads['emoji-picker']): void {
  emojiLog.info('emojiPicker.invoke', { tokenLen: payload.token?.length ?? 0 });
  // Invoked from inside another heroui sheet (e.g. the Copy split-button
  // menu on Send Ecash). That sheet animates closed via gorhom (~200ms)
  // when its Menu.Item's onPress runs — *before* heroui's onPress closes
  // it. Without a delay, both sheets briefly co-exist in heroui's single
  // `PortalHost` and gorhom can't cleanly hand off, leaving our sheet
  // stuck closed. Same pattern as `profileSwitcherPopup` →
  // `openProfileImportMenu` (200ms close + 100ms buffer).
  setTimeout(() => {
    emojiLog.info('emojiPicker.dispatch.fire', { tokenLen: payload.token?.length ?? 0 });
    showActionSheet('emoji-picker', payload);
  }, 300);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Align the first/last cell's outer edge with the search bar bg
    // (which sits at 24px from the sheet edge — see the search field wrapper)
    // and the first/last tab pill's outer edge (also 24px from the
    // sheet edge — see `anchorBarStyle.paddingHorizontal: 24`).
    paddingHorizontal: 24,
  },
  emojiCell: {
    width: CELL_WIDTH_PCT as unknown as number,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  emojiCellPressed: {
    // Replicates `TouchableOpacity activeOpacity={0.6}`'s press feedback
    // without TouchableOpacity's per-cell Animated.View overhead.
    opacity: 0.6,
  },
  emojiText: {
    fontSize: 28,
  },
});
