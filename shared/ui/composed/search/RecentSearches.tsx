/**
 * @fileoverview Empty-query body for the unified search surface.
 *
 * Shown on every surface (Contacts, Feed, Wallet) the moment search is open but
 * nothing is typed, regardless of selected scope. Two consistent sections:
 *   1. Recent query chips — tap to re-run (per-surface, via `useRecentSearches`).
 *   2. Recent people strip — shared across surfaces (`recentPeopleStore`).
 * Followed by a prompt explaining what can be searched.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import { RecentPeopleSearchStrip } from '@/features/feed/components/RecentPeopleSearchStrip';
import { useRecentSearches, type RecentSearchSurface } from './useRecentSearches';

export type EmptySearchPrompt = { icon: string; title: string; subtitle: string };

const DEFAULT_PROMPT: EmptySearchPrompt = {
  icon: 'mingcute:search-3-line',
  title: 'Search people, mints and places',
  subtitle: 'Enter a name, NIP-05, npub, mint, or place to get started',
};

export function RecentSearches({
  surface,
  onPickQuery,
  prompt = DEFAULT_PROMPT,
}: {
  surface: RecentSearchSurface;
  onPickQuery: (query: string) => void;
  prompt?: EmptySearchPrompt;
}) {
  const { queries, clearQueries } = useRecentSearches(surface);
  const [foreground, muted, accent] = useThemeColor(['foreground', 'muted', 'accent'] as const);

  return (
    <ScrollView
      style={styles.flex1}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}>
      {queries.length > 0 ? (
        <View style={styles.section}>
          <HStack align="center" justify="space-between" style={styles.sectionTitle}>
            <Text bold size={15} color={foreground}>
              Recent searches
            </Text>
            <Pressable
              onPress={clearQueries}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches">
              <Text size={13} color={accent}>
                Clear
              </Text>
            </Pressable>
          </HStack>
          <View style={styles.chipWrap}>
            {queries.map((entry) => (
              <FeedTabButton
                key={entry.query}
                label={entry.query}
                active={false}
                onPress={() => onPickQuery(entry.query)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <RecentPeopleSearchStrip showClear title="Recent people" />

      <VStack spacing={24} align="center" className="mt-3 px-4" style={styles.prompt}>
        <VStack
          justify="center"
          align="center"
          className="bg-surface-secondary h-20 w-20 rounded-full">
          <Icon name={prompt.icon} size={40} color={muted} />
        </VStack>
        <VStack spacing={12}>
          <Text className="text-center" color={foreground} bold size={20}>
            {prompt.title}
          </Text>
          <Text className="text-center" color={muted} size={16}>
            {prompt.subtitle}
          </Text>
        </VStack>
      </VStack>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16 },
  section: { paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  prompt: { flex: 1 },
});
