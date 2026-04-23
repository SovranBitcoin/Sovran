import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';

import { copyPopup } from '@/shared/lib/popup';
import { encode } from '@/shared/lib/third-party/emoji';
import { prefetchImages } from '@/shared/lib/imageCache';
import { AnimatedEmoji, getAnimatedEmojiUrl } from '@/shared/ui/primitives/AnimatedEmoji';
import { CurrencyIcon } from 'assets/icons';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SectionAnchorList, type AnchorSection } from '@/shared/ui/composed/SectionAnchorList';
import { SheetHeader } from '../SheetHeader';
import { CATEGORIES, ALL_EMOJIS, searchEmojis } from './emojiData';
import type { EmojiEntry } from './emojiData';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import opacity from 'hex-color-opacity';

interface EmojiPickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['emoji-picker'];
}

const COLS = 6;
const CELL_WIDTH_PCT = `${100 / COLS}%` as const;

function EmojiGrid({
  emojis,
  onSelect,
}: {
  emojis: EmojiEntry[];
  onSelect: (emoji: string) => void;
}) {
  return (
    <View style={styles.grid}>
      {emojis.map((entry) => (
        <TouchableOpacity
          key={entry.emoji}
          testID={`emoji-${entry.keywords[0]}`}
          activeOpacity={0.6}
          onPress={() => onSelect(entry.emoji)}
          style={styles.emojiCell}>
          <Text style={{ fontSize: 28 }}>{entry.emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function EmojiPickerContent({
  payload,
  close,
  popCustomPage,
  canPop,
  setFooterConfig,
}: EmojiPickerContentProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [foreground, surfaceSecondary, surface] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface',
  ] as const);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const isSearching = searchQuery.length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return searchEmojis(searchQuery);
  }, [isSearching, searchQuery]);

  // Prefetch all emoji animations on mount
  useEffect(() => {
    const urls = ALL_EMOJIS.map((e) => getAnimatedEmojiUrl(e.emoji));
    prefetchImages(urls);
  }, []);

  useEffect(() => {
    setFooterConfig(
      canPop
        ? {
            buttons: [
              {
                label: 'Back',
                variant: 'tertiary',
                onPress: popCustomPage,
              },
            ],
          }
        : null
    );
    return () => setFooterConfig(null);
  }, [setFooterConfig, canPop, popCustomPage]);

  const handleEmojiSelect = useCallback(
    async (emoji: string) => {
      const encodedEmoji = encode(emoji, payload.token);
      await Clipboard.setStringAsync(encodedEmoji);
      copyPopup('token', {
        onOpen: close,
        icon: <AnimatedEmoji emoji={emoji} size={28} />,
      });
    },
    [payload.token, close]
  );

  const handleSearch = useCallback((text: string) => {
    setInputText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(text);
    }, 150);
  }, []);

  const handleClear = useCallback(() => {
    setInputText('');
    setSearchQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.clear();
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Emojis render inside a 6-column grid per category, which
  // SectionAnchorList's default one-item-per-row renderItem can't
  // produce. Put the entire grid inside each section's `renderHeader`
  // and keep `data` empty so renderItem never fires. `overrideContent`
  // handles the search-results flip where there are no categories.
  const categorySections = useMemo<AnchorSection<EmojiEntry>[]>(() => {
    // For the browse view, each section's renderHeader emits both the
    // category label AND the grid. data stays empty so renderItem never
    // fires — we treat each section as a custom block.
    return CATEGORIES.map((cat) => ({
      id: cat.id,
      anchor: {
        icon:
          cat.id === 'bitcoin' ? (
            <CurrencyIcon width={16} currency="sat" />
          ) : (
            <Text style={{ fontSize: 14 }}>{cat.icon}</Text>
          ),
        label: cat.label,
      },
      data: [] as EmojiEntry[],
      renderHeader: () => (
        <View>
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'OxygenBold',
              color: opacity(foreground, 0.4),
              marginBottom: 4,
              marginTop: 8,
              paddingLeft: 6,
            }}>
            {cat.label}
          </Text>
          <EmojiGrid emojis={cat.emojis} onSelect={handleEmojiSelect} />
        </View>
      ),
    }));
  }, [foreground, handleEmojiSelect]);

  // Override content for search-results mode + no-match state.
  const overrideContent = useMemo(() => {
    if (!isSearching) return null;
    if (searchResults.length === 0) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Text style={{ color: opacity(foreground, 0.4), fontSize: 14 }}>No emoji found</Text>
        </View>
      );
    }
    return <EmojiGrid emojis={searchResults} onSelect={handleEmojiSelect} />;
  }, [isSearching, searchResults, foreground, handleEmojiSelect]);

  return (
    <SectionAnchorList<EmojiEntry>
      sections={categorySections}
      renderItem={() => null}
      keyExtractor={(item) => item.emoji}
      ScrollComponent={BottomSheetScrollView as any}
      overrideContent={overrideContent}
      topFadeColor={String(surface)}
      aboveAnchors={
        <>
          <SheetHeader title="Emoji" />
          <View style={{ paddingTop: 8 }}>
            <View style={styles.searchContainer}>
              <TextInput
                ref={inputRef}
                placeholder="Search emoji..."
                placeholderTextColor={opacity(foreground, 0.33)}
                onChangeText={handleSearch}
                autoCorrect={false}
                style={[
                  styles.searchInput,
                  { backgroundColor: surfaceSecondary, color: foreground },
                ]}
              />
              {inputText.length > 0 && (
                <Pressable onPress={handleClear} style={styles.clearButton} hitSlop={8}>
                  <IconSymbol
                    name="xmark.circle.fill"
                    size={18}
                    color={opacity(foreground, 0.33)}
                  />
                </Pressable>
              )}
            </View>
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingRight: 36,
    fontSize: 15,
  },
  clearButton: {
    position: 'absolute',
    right: 10,
    padding: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emojiCell: {
    width: CELL_WIDTH_PCT as any,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
});
