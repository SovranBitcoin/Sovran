/**
 * @fileoverview The emoji sheet: categories as scroll-to-section tabs, plus a
 * search field that flips the body to flat results.
 *
 * The `emojiPicker` route's page, in the same sheet as Select mint on iPhone
 * and a pushed page on Android. Whoever opens it calls `openEmojiPicker` and
 * hears back which emoji was tapped; what is done with it (copying a token as
 * that emoji) is the opener's business.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CurrencyIcon } from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { log, useMountLog, useRenderLogger } from '@/shared/lib/logger';
import { emojiSheet } from '@/shared/lib/picker/openEmojiPicker';
import { useSheetRouteScreen } from '@/shared/lib/picker/useSheetRouteScreen';
import { SheetSearchField } from '@/shared/lib/popup/SheetSearchField';
import {
  CATEGORIES,
  searchEmojis,
  type EmojiCategory,
  type EmojiEntry,
} from '@/shared/lib/popup/popups/emojiData';
import {
  emojiCodepointKey,
  emojiPickerOptionTestID,
} from '@/shared/lib/popup/popups/emojiPickerIds';
import { List } from '@/shared/ui/composed/List';
import { renderSheetCloseButton } from '@/shared/ui/composed/PickerSheet';
import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { SectionAnchorList, type AnchorSection } from '@/shared/ui/composed/SectionAnchorList';
import { prefetchAnimatedEmojis } from '@/shared/ui/primitives/AnimatedEmoji';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const emojiLog = log.child({ module: 'emojiPicker' });

const COLS = 6;
const PREFETCH_EMOJIS = CATEGORIES.flatMap((category) => category.emojis)
  .slice(0, 24)
  .map((entry) => entry.emoji);

/**
 * Single emoji cell. With ~6 cells per row and dozens of rows recycled during
 * a long scroll, the compiler's element-identity memoization skipping an
 * unchanged cell is the difference between a smooth jump and a multi-second
 * JS-thread block. `Pressable` defers its gesture handler until first touch,
 * which keeps recycling cheap.
 */
function EmojiCell({ entry, onSelect }: { entry: EmojiEntry; onSelect: (emoji: string) => void }) {
  return (
    <Pressable
      testID={emojiPickerOptionTestID(entry.emoji)}
      accessibilityRole="button"
      accessibilityLabel={entry.keywords[0] ?? entry.emoji}
      onPress={() => onSelect(entry.emoji)}
      activeOpacity={0.6}
      className="w-1/6 items-center justify-center py-1.5">
      <Text size={28}>{entry.emoji}</Text>
    </Pressable>
  );
}

/** One virtualized row of up to `COLS` cells: the row is the unit of virtualization. */
function EmojiRow({
  emojis,
  onSelect,
}: {
  emojis: EmojiEntry[];
  onSelect: (emoji: string) => void;
}) {
  return (
    <View className="flex-row px-4">
      {emojis.map((entry) => (
        <EmojiCell key={entry.emoji} entry={entry} onSelect={onSelect} />
      ))}
    </View>
  );
}

/** Rows of `COLS` for the search results, which bypass the sections. */
function chunkEmojis(emojis: EmojiEntry[]): EmojiEntry[][] {
  const rows: EmojiEntry[][] = [];
  for (let i = 0; i < emojis.length; i += COLS) {
    rows.push(emojis.slice(i, i + COLS));
  }
  return rows;
}

// Module-level stable callbacks. `keyExtractor` identity feeds
// `SectionAnchorList`'s flatten step — an inline function defeated its
// caching and rebuilt the 228-row flat array on every parent re-render.
// `noop` covers the unused `renderItem` slot: this grid renders whole rows.
const emojiKeyExtractor = (item: EmojiEntry): string => item.emoji;
const noopRenderItem = (): null => null;

const searchRowKeyExtractor = (row: EmojiEntry[], index: number): string => {
  const rowKey = row
    .map((entry) => `${emojiCodepointKey(entry.emoji)}:${entry.keywords[0] ?? 'emoji'}`)
    .join('|');
  return rowKey.length > 0 ? rowKey : `search-row-${index}`;
};

// Each category is a virtualized section; the anchor pill is its only label.
// Reads only module data, so it's built once at module scope.
const CATEGORY_SECTIONS: AnchorSection<EmojiEntry>[] = CATEGORIES.map((cat: EmojiCategory) => ({
  id: cat.id,
  anchor: {
    icon:
      cat.id === 'bitcoin' ? <CurrencyIcon width={16} currency="sat" /> : <Text>{cat.icon}</Text>,
    label: cat.label,
    testID: `emoji-tab-${cat.id}`,
  },
  data: cat.emojis,
}));

export function EmojiPickerSheetScreen() {
  // The picker shouldn't re-render 30 times in normal use (search debounce
  // and tab taps are the only churn); more hints at unstable callbacks.
  useRenderLogger('EmojiPickerSheetScreen', 30, emojiLog);
  const pick = useSheetRouteScreen(emojiSheet);
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);

  useScreenOptions(() => ({ headerLeft: renderSheetCloseButton }), []);

  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSearching = searchQuery.length > 0;

  useEffect(() => {
    void prefetchAnimatedEmojis(PREFETCH_EMOJIS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Time the substring search so a slow query (the dataset is ~1500 emojis)
  // shows up in `slow` / `errors` modes: it runs on the JS thread, so a >50ms
  // hit blocks input handling. The body logs once per query change; the
  // explicit dep array is the contract here, not an optimization.
  // ast-grep-ignore: no-manual-memo-tsx
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const start = Date.now();
    const results = searchEmojis(searchQuery);
    const elapsed = Date.now() - start;
    emojiLog[elapsed > 50 ? 'warn' : 'debug']('emojiPicker.search.run', {
      query: searchQuery,
      queryLen: searchQuery.length,
      resultsCount: results.length,
      elapsedMs: elapsed,
    });
    return results;
  }, [isSearching, searchQuery]);

  // One record per open: confirms the categories list isn't unexpectedly
  // empty, which has happened after data refactors.
  useMountLog(
    'emojiPicker.mount',
    {
      categories: CATEGORIES.length,
      totalEmojis: CATEGORIES.reduce((acc, c) => acc + c.emojis.length, 0),
      cols: COLS,
    },
    'emojiPicker.unmount',
    emojiLog
  );

  const handleEmojiSelect = (emoji: string) => {
    emojiLog.info('emojiPicker.select', { emoji, fromSearch: searchQuery.length > 0 });
    pick({ kind: 'option', id: emoji });
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

  const renderEmojiRow = (items: EmojiEntry[]) => (
    <EmojiRow emojis={items} onSelect={handleEmojiSelect} />
  );
  const renderEmojiSearchRow = ({ item }: { item: EmojiEntry[] }) => (
    <EmojiRow emojis={item} onSelect={handleEmojiSelect} />
  );

  // While searching the sections give way to flat results: centered "No emoji
  // found" when empty, else their own virtualized list.
  const overrideContent = !isSearching ? null : searchResults.length === 0 ? (
    <View testID="emoji-picker-no-results" className="items-center py-8">
      <Text size={14} color={withAlpha(foreground, 0.4)}>
        No emoji found
      </Text>
    </View>
  ) : (
    <List<EmojiEntry[]>
      data={chunkEmojis(searchResults)}
      keyExtractor={searchRowKeyExtractor}
      renderItem={renderEmojiSearchRow}
      // The same draw window as the sections, so both modes buffer alike on
      // a fast scroll.
      drawDistance={150}
      contentContainerClassName="pb-6"
      keyboardShouldPersistTaps="handled"
    />
  );

  return (
    // `safeArea` starts the frame under the native header, so the search
    // field and tabs sit below the title.
    <Screen name="EmojiPickerSheetScreen" scroll="custom" safeArea bgColor={surface}>
      <SectionAnchorList<EmojiEntry>
        testID="emoji-picker"
        sections={CATEGORY_SECTIONS}
        rowChunkSize={COLS}
        renderRow={renderEmojiRow}
        renderItem={noopRenderItem}
        keyExtractor={emojiKeyExtractor}
        overrideContent={overrideContent}
        topFadeColor={surface}
        contentBottomInset={24}
        aboveAnchors={
          // The search field's own View is the clear button's containing
          // block, so the gutter goes on a wrapper around it.
          <View className="px-4 pt-2">
            <SheetSearchField
              testID="emoji-picker-search"
              clearTestID="emoji-picker-search-clear"
              placeholder="Search emoji..."
              value={inputText}
              onChangeText={handleSearchChange}
              onClear={handleSearchClear}
            />
          </View>
        }
      />
    </Screen>
  );
}
