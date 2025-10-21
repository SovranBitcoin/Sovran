import React, { FC, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { ContactItem } from './ContactItem';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import {
  FULL_DRAG_DISTANCE,
  TRIGGER_DRAG_DISTANCE,
  usePaymentsAnimation,
} from 'providers/PaymentsAnimationProvider';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

// Memoized ContactItem for search results
const SearchResultItem = React.memo(({ item }: { item: any }) => {
  return <ContactItem item={item} />;
});

SearchResultItem.displayName = 'SearchResultItem';

interface SearchResultsOverlayProps {
  allContacts: any[];
  allMints: any[];
  searchQuery: string;
}

export const SearchResultsOverlay: FC<SearchResultsOverlayProps> = ({
  allContacts,
  allMints,
  searchQuery,
}) => {
  const { getPrimaryColor } = useTheme();
  const { screenView, offsetY } = usePaymentsAnimation();

  // Filter contacts and mints based on search query
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }

    const query = searchQuery.toLowerCase();
    const results: any[] = [];

    // Search in contacts
    allContacts.forEach((contact) => {
      if (contact.pubkey?.toLowerCase().includes(query)) {
        results.push(contact);
      }
    });

    // Search in mints
    allMints.forEach((mint) => {
      if (
        mint.mint?.mintUrl?.toLowerCase().includes(query) ||
        mint.mintInfo?.name?.toLowerCase().includes(query)
      ) {
        results.push(mint);
      }
    });

    return results;
  }, [allContacts, allMints, searchQuery]);

  // Animate overlay appearance
  const rContainerStyle = useAnimatedStyle(() => {
    return {
      opacity:
        screenView.value === 'search'
          ? 1
          : interpolate(
              offsetY.value,
              [FULL_DRAG_DISTANCE * 0.2, FULL_DRAG_DISTANCE],
              [0, 1],
              Extrapolation.CLAMP
            ),
      transform: [{ translateY: -offsetY.value }],
      pointerEvents: screenView.value === 'search' ? 'auto' : 'none',
    };
  });

  // Top gradient style
  const rTopGradientStyle = useAnimatedStyle(() => {
    return {
      opacity:
        screenView.value === 'search' && offsetY.value > TRIGGER_DRAG_DISTANCE
          ? withTiming(1, { duration: 1000 })
          : 0,
    };
  });

  const keyExtractor = (item: any, index: number) => {
    return item.pubkey || item.mint?.mintUrl || `search-${index}`;
  };

  return (
    <Animated.View className="absolute h-full w-full" style={rContainerStyle}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        {filteredResults.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: getPrimaryColor('400') }}>
              {searchQuery.trim() ? 'No results found' : 'Start typing to search...'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredResults}
            renderItem={({ item }) => <SearchResultItem item={item} />}
            keyExtractor={keyExtractor}
            className="flex-1"
            contentContainerClassName="gap-4 px-5"
            contentContainerStyle={{
              paddingTop: 100, // Space for header
              paddingBottom: 100,
            }}
            indicatorStyle="white"
            showsVerticalScrollIndicator={true}
          />
        )}
      </KeyboardAvoidingView>
      {/* Top gradient for visual depth */}
      <Animated.View
        style={[
          rTopGradientStyle,
          StyleSheet.absoluteFillObject,
          {
            height: 100,
            backgroundColor: getPrimaryColor('900'),
            opacity: 0.8,
          },
        ]}
      />
    </Animated.View>
  );
};
