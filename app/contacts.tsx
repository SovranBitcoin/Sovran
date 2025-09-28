import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Image, ScrollView, Keyboard, TextInput as RNTextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { greens, greys, reds, Theme } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Container from 'components/blocks/Container';
import Icon from 'assets/icons';
import { SkeletonContainer, Skeleton } from 'react-native-skeleton-component';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { store } from 'helper/redux/store';
import { setSearch } from 'helper/redux/nostr';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { searchUsers as apiSearchUsers, UserProfile } from 'helper/apiClient';

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

function NoResultsFound({ theme }: { theme: Theme }) {
  return (
    <VStack spacing={24} align="center" className="mt-6 px-6">
      <View
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: greys(theme)[800] }}>
        <Icon name="nonicons:error-16" size={40} color={greys(theme)[400]} />
      </View>

      <VStack spacing={12}>
        <Text
          className="text-center"
          overpass
          bold
          size={20}
          style={{
            color: greys(theme)[50],
          }}>
          No Results Found
        </Text>

        <Text
          className="text-center"
          overpass
          regular
          size={16}
          style={{
            color: greys(theme)[400],
          }}>
          {"We couldn't find any users matching your search"}
        </Text>
      </VStack>

      <View className="w-full rounded-xl p-4" style={{ backgroundColor: greys(theme)[800] }}>
        <Text
          overpass
          bold
          size={16}
          style={{
            color: greys(theme)[100],
          }}>
          Try adjusting your search:
        </Text>
        <Spacer size={8} />
        <VStack spacing={12}>
          <SearchTip icon="lucide:pencil-line" text="Check your spelling" theme={theme} />
          <SearchTip icon="solar:key-bold" text="Try using a complete public key" theme={theme} />
          <SearchTip icon="mdi:at" text="Use a different NIP-05 identifier" theme={theme} />
        </VStack>
      </View>
    </VStack>
  );
}

function EmptyStateView({ theme }: { theme: Theme }) {
  return (
    <VStack spacing={24} align="center" className="mt-6">
      <View
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: greys(theme)[800] }}>
        <Icon name="majesticons:search-line" size={40} color={greys(theme)[400]} />
      </View>

      <Text
        className="text-center"
        overpass
        bold
        size={20}
        style={{
          color: greys(theme)[50],
        }}>
        Search for Users
      </Text>

      <Text
        className="text-center"
        size={16}
        overpass
        regular
        style={{
          color: greys(theme)[400],
        }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      <View className="w-full rounded-xl p-4" style={{ backgroundColor: greys(theme)[800] }}>
        <Text
          overpass
          bold
          size={16}
          style={{
            color: greys(theme)[100],
          }}>
          Search Tips:
        </Text>
        <Spacer size={8} />
        <VStack spacing={12}>
          <SearchTip icon="ph:user-bold" text="Search by username or display name" theme={theme} />
          <SearchTip icon="solar:key-bold" text="Search by public key" theme={theme} />
          <SearchTip icon="mdi:at" text="Search by NIP-05 identifier" theme={theme} />
        </VStack>
      </View>
    </VStack>
  );
}

function SearchTip({ icon, text, theme }: { icon: string; text: string; theme: Theme }) {
  return (
    <HStack spacing={0} align="center">
      <Icon name={icon} size={20} color={greys(theme)[300]} />
      <Text className="flex-1 pl-2" size={14} overpass regular style={{ color: greys(theme)[200] }}>
        {text}
      </Text>
    </HStack>
  );
}

interface SearchResultProps {
  result: DisplayResult;
  onPress: () => void;
  loading: boolean;
}

function SearchResult({ result, onPress, loading }: SearchResultProps) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center rounded-lg p-2"
      style={{ backgroundColor: greys(theme)[800] }}
      disabled={loading || !result.profile}>
      <HStack spacing={8}>
        <ProfileImage loading={loading} profile={result.profile} />
        <View className="flex-1">
          <Text loading={loading} overpass bold size={16} style={{ color: greys(theme)[50] }}>
            {result.profile?.displayName || result.profile?.name || 'Loading...'}
          </Text>
          {result.profile?.nip05 && (
            <Text
              loading={loading}
              overpass
              regular
              size={12}
              style={{
                color: result.profile.nip05Valid ? greens[300] : reds[300],
              }}>
              {result.profile.nip05Valid ? '✓ ' : '✗ '}
              {result.profile.nip05}
            </Text>
          )}
        </View>
      </HStack>
    </TouchableOpacity>
  );
}

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

function ProfileImage({ profile, loading }: ProfileImageProps) {
  const theme = useSelector(memoizedGetTheme);
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  return (
    <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }}>
      {!loading && (
        <>
          {profile?.picture && !imageError ? (
            <Image
              source={{ uri: profile.picture }}
              onError={handleImageError}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
              }}
            />
          ) : (
            <View
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: greys(theme)[950] }}>
              <Icon name="ph:user-bold" size={24} color={greys(theme)[400]} />
            </View>
          )}
        </>
      )}
    </Skeleton>
  );
}

export default withSheetProvider(ModalScreen);
