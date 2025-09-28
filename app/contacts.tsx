import React, { useRef, useState, useCallback, useMemo } from 'react';
import { ScrollView, Keyboard, TextInput as RNTextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Container from 'components/blocks/Container';
import Icon from 'assets/icons';
import { SkeletonContainer } from 'react-native-skeleton-component';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { store } from 'helper/redux/store';
import { setSearch } from 'helper/redux/nostr';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { searchUsers as apiSearchUsers, UserProfile } from 'helper/apiClient';
import { NoResultsFound, EmptyStateView, SearchResult } from 'components/blocks/contacts';

// Define proper types for our component
interface SearchResultData {
  pubkey: string;
  profile: UserProfile;
}

interface PlaceholderResult {
  pubkey: string;
  profile?: undefined; // Explicitly undefined for loading state
}

type DisplayResult = SearchResultData | PlaceholderResult;

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const inputRef = useRef<RNTextInput>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const navigation = useTypedNavigation();

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate placeholder results for the loading state
  const placeholderResults = useMemo<PlaceholderResult[]>(
    () =>
      Array(20)
        .fill(null)
        .map((_, index) => ({
          pubkey: `placeholder-${index}`,
        })),
    []
  );

  // Improved search function with better error handling and no Redux dispatch in loop
  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    setHasSearched(true);

    try {
      const result = await apiSearchUsers({ query, limit: 10 });

      if (result.isOk()) {
        const data = result.value;

        if (data.results && Array.isArray(data.results)) {
          const formattedResults: SearchResultData[] = data.results.map((res) => {
            const profileEventPubkey = JSON.parse(res.profileEvent).pubkey;

            return {
              pubkey: res.pubkey,
              profile: {
                ...res,
                pubkey: profileEventPubkey,
              },
            };
          });

          // Store all results in Redux at once (not in a loop)
          if (formattedResults.length > 0) {
            // Convert to the format expected by setSearch (single object, not array)
            formattedResults.forEach((result) => {
              store.dispatch(setSearch({ pubkey: result.pubkey, profile: result.profile }));
            });
          }

          setSearchResults(formattedResults);
        } else {
          setSearchResults([]);
        }
      } else {
        console.error('Error searching users:', result.error);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Unexpected error during search:', error);
      setSearchResults([]);
    }

    setLoading(false); // Remove artificial delay
  }, []);

  // Improved debounced search with cleanup
  const handleSearchQueryChange = useCallback(
    (input: string) => {
      setSearchQuery(input);

      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Reset state if search is cleared
      if (!input.trim()) {
        setHasSearched(false);
        setSearchResults([]);
        return;
      }

      // Debounce the search
      debounceTimeoutRef.current = setTimeout(() => {
        searchUsers(input);
      }, 500); // Reduced to 500ms for better responsiveness
    },
    [searchUsers]
  );

  const handleScroll = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const clearSearchInput = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
  }, []);

  const navigateToUserMessages = useCallback(
    ({ pubkey, profile }: { pubkey: string; profile: UserProfile }) => {
      navigation.goBack();
      navigation.goBack();
      navigation.navigate('userMessages', {
        pubkey: pubkey,
        profile,
      });
    },
    [navigation]
  );

  // Memoized computed values
  const displayResults: DisplayResult[] = useMemo(
    () => (loading ? placeholderResults : searchResults),
    [loading, placeholderResults, searchResults]
  );

  const showResults = loading || searchResults.length > 0;
  const showEmptyState = !hasSearched && !loading;
  const showNoResults = hasSearched && !loading && searchResults.length === 0;

  // Skeleton configuration
  const skeletonConfig = useMemo(
    () => ({
      backgroundColor: greys(theme)[800],
      highlightColor: greys(theme)[600],
      speed: 800,
      animation: loading ? ('pulse' as const) : ('none' as const),
    }),
    [theme, loading]
  );

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: greys(theme)[950] }}>
      <SkeletonContainer
        backgroundColor={skeletonConfig.backgroundColor}
        highlightColor={skeletonConfig.highlightColor}
        speed={skeletonConfig.speed}
        animation={skeletonConfig.animation}>
        <Container contentContainerStyle={{ paddingHorizontal: 0, flex: 1 }}>
          <ScrollView
            className="flex-1"
            style={{ backgroundColor: greys(theme)[950] }}
            onScrollBeginDrag={handleScroll}
            scrollEventThrottle={16}>
            <View className="bg-transparent px-4" style={{ backgroundColor: greys(theme)[950] }}>
              <View className="flex-row items-center">
                <View className="relative flex-1">
                  <RNTextInput
                    ref={inputRef}
                    value={searchQuery}
                    onChangeText={handleSearchQueryChange}
                    placeholder="Search users..."
                    placeholderTextColor={greys(theme)[500]}
                    style={{
                      flex: 1,
                      paddingRight: 30,
                      backgroundColor: greys(theme)[800],
                      borderRadius: 16,
                      padding: 14,
                      fontSize: 16,
                      fontFamily: 'OverpassRegular',
                      color: greys(theme)[0],
                    }}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={clearSearchInput}
                      className="absolute right-0 z-10 p-3.5">
                      <Icon name="simple-line-icons:close" size={20} color={greys(theme)[50]} />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                  <HStack spacing={12}>
                    <Spacer size={12} />
                    <Text overpass bold size={16} style={{ color: greys(theme)[50] }}>
                      Cancel
                    </Text>
                  </HStack>
                </TouchableOpacity>
              </View>

              {showResults && (
                <VStack spacing={12} className="mt-6">
                  <VStack spacing={12}>
                    <Text
                      loading={loading}
                      overpass
                      bold
                      size={16}
                      style={{
                        color: greys(theme)[400],
                      }}>
                      Found {searchResults.length}{' '}
                      {searchResults.length === 1 ? 'result' : 'results'}
                    </Text>
                  </VStack>
                  {displayResults.map((result) => (
                    <SearchResult
                      key={result.pubkey}
                      loading={loading}
                      result={result}
                      onPress={() => {
                        if (!loading && result.profile) {
                          navigateToUserMessages({
                            pubkey: result.pubkey,
                            profile: result.profile,
                          });
                        }
                      }}
                    />
                  ))}
                </VStack>
              )}

              {showEmptyState && <EmptyStateView theme={theme} />}
              {showNoResults && <NoResultsFound theme={theme} />}
            </View>
          </ScrollView>
        </Container>
      </SkeletonContainer>
    </SafeAreaView>
  );
}

export default withSheetProvider(ModalScreen);
