import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  NativeScrollEvent,
  Pressable,
} from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
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
const GRADIENT_HEIGHT = 40;

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
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [foreground, surfaceSecondary, surfaceTertiary, surface] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
    'surface',
  ] as const);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<any>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const programmaticScroll = useRef(false);
  const tabScrollRef = useRef<ScrollView>(null);
  const tabOffsets = useRef<Record<string, { x: number; width: number }>>({});

  const isSearching = searchQuery.length > 0;

  // Scroll the active tab into view
  useEffect(() => {
    const tab = tabOffsets.current[activeCategory];
    if (tab && tabScrollRef.current) {
      // Center the tab in the scroll view
      const scrollTo = Math.max(0, tab.x - 18);
      tabScrollRef.current.scrollTo({ x: scrollTo, animated: true });
    }
  }, [activeCategory]);

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

  const handleSectionLayout = useCallback((categoryId: string, y: number) => {
    sectionOffsets.current[categoryId] = y;
  }, []);

  const handleScroll = useCallback(
    (e: { nativeEvent: NativeScrollEvent }) => {
      if (programmaticScroll.current) return;
      const y = e.nativeEvent.contentOffset.y;
      let current = CATEGORIES[0].id;
      for (const cat of CATEGORIES) {
        const offset = sectionOffsets.current[cat.id];
        if (offset != null && offset <= y + 40) {
          current = cat.id;
        }
      }
      if (current !== activeCategory) {
        setActiveCategory(current);
      }
    },
    [activeCategory]
  );

  const handleCategoryPress = useCallback((id: string) => {
    setActiveCategory(id);
    const offset = sectionOffsets.current[id];
    if (offset != null && scrollRef.current) {
      programmaticScroll.current = true;
      scrollRef.current.scrollTo({ y: offset, animated: true });
      setTimeout(() => {
        programmaticScroll.current = false;
      }, 400);
    }
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <SheetHeader title="Emoji" />

      <View style={{ paddingTop: 8, paddingHorizontal: 0, gap: 6, zIndex: 20 }}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            ref={inputRef}
            placeholder="Search emoji..."
            placeholderTextColor={opacity(foreground, 0.33)}
            onChangeText={handleSearch}
            autoCorrect={false}
            style={[styles.searchInput, { backgroundColor: surfaceSecondary, color: foreground }]}
          />
          {inputText.length > 0 && (
            <Pressable onPress={handleClear} style={styles.clearButton} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={18} color={opacity(foreground, 0.33)} />
            </Pressable>
          )}
        </View>

        {/* Category Tabs */}
        {!isSearching && (
          <ScrollView
            ref={tabScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -18 }}
            contentContainerStyle={{ gap: 4, paddingHorizontal: 18 }}>
            {CATEGORIES.map((cat) => {
              const isSelected = activeCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleCategoryPress(cat.id)}
                  onLayout={(e) => {
                    tabOffsets.current[cat.id] = {
                      x: e.nativeEvent.layout.x,
                      width: e.nativeEvent.layout.width,
                    };
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.categoryTab,
                    { backgroundColor: isSelected ? surfaceTertiary : 'transparent' },
                  ]}>
                  {cat.id === 'bitcoin' ? (
                    <CurrencyIcon width={16} currency="sat" />
                  ) : (
                    <Text style={{ fontSize: 14 }}>{cat.icon}</Text>
                  )}
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: 'OxygenBold',
                      color: foreground,
                    }}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

      </View>

      {/* Scrollable Emoji Content — negative margin tucks behind tabs */}
      <View style={{ flex: 1, marginTop: -GRADIENT_HEIGHT }}>
        {/* Gradient overlay at top of scroll area, behind tabs */}
        <View style={styles.scrollGradient} pointerEvents="none">
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={['black', 'black', 'transparent']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFill}
              />
            }>
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={[String(surface), 'transparent']}
              locations={[0.5, 1]}
              style={StyleSheet.absoluteFill}
            />
          </MaskedView>
        </View>

        <BottomSheetScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerClassName="px-0 pb-safe-offset-4"
          contentContainerStyle={{ paddingTop: GRADIENT_HEIGHT }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View>
            {isSearching ? (
              searchResults.length > 0 ? (
                <EmojiGrid emojis={searchResults} onSelect={handleEmojiSelect} />
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <Text style={{ color: opacity(foreground, 0.4), fontSize: 14 }}>
                    No emoji found
                  </Text>
                </View>
              )
            ) : (
              CATEGORIES.map((cat) => (
                <View
                  key={cat.id}
                  onLayout={(e) => handleSectionLayout(cat.id, e.nativeEvent.layout.y)}>
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
              ))
            )}
          </View>
        </BottomSheetScrollView>
      </View>
    </View>
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
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 1000,
  },
  scrollGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: GRADIENT_HEIGHT,
    zIndex: 10,
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
