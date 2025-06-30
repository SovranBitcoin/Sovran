import React, { useRef, useState } from 'react';
import { Image, ScrollView, Keyboard, TextInput as RNTextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { greens, greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { NDKUser } from '@nostr-dev-kit/ndk';
import { SkeletonContainer, Skeleton } from 'react-native-skeleton-component';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { store } from 'helper/redux/store';
import { setSearch } from 'helper/redux/nostr';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { searchUsers as apiSearchUsers } from 'helper/api/sovran';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const inputRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const navigation = useTypedNavigation();

  const debounceTimeoutRef = useRef(null);

  // Generate placeholder results for the loading state
  const placeholderResults = Array(20)
    .fill(null)
    .map((_, index) => ({
      pubkey: index,
    }));

  // New function to search using the API instead of DVM
  const searchUsers = async (query) => {
    if (!query.trim()) return;

    setLoading(true);
    setHasSearched(true); // Set this to true when search is initiated

    try {
      const data = await apiSearchUsers({ query, limit: 10 });

      if (data.results && Array.isArray(data.results)) {
        const formattedResults = data.results.map((result) => {
          const pubkey = JSON.parse(result.profileEvent).pubkey;
          const user = new NDKUser({
            pubkey: pubkey,
          });
          user.profile = result;
          return {
            pubkey: user.pubkey,
            profile: {
              ...user.profile,
              pubkey,
            },
          };
        });

        for (const result of formattedResults) {
          const newResults = [{ pubkey: result?.pubkey, profile: result }];
          const uniqueResults = [
            ...new Map(newResults.map((item) => [item.pubkey, item.profile])).values(),
          ];
          store.dispatch(setSearch(uniqueResults));
        }

        setSearchResults(formattedResults);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    }
  };

  const handleSearchQueryChange = (input) => {
    setSearchQuery(input);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // If search query is cleared, reset hasSearched state
    if (!input.trim()) {
      setHasSearched(false);
      setSearchResults([]);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      if (input.trim()) {
        searchUsers(input);
      } else {
        setSearchResults([]);
        setHasSearched(false);
      }
    }, 800); // Reduced timeout to 800ms for better UX
  };

  const handleScroll = () => {
    Keyboard.dismiss();
  };

  // New function to clear the search input
  const clearSearchInput = () => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false); // Reset hasSearched when search is cleared
  };

  const navigateToUserMessages = ({ pubkey, profile }) => {
    navigation.goBack();
    navigation.goBack();
    navigation.navigate('userMessages', {
      pubkey: pubkey,
      profile,
    });
  };

  // Display the search results or loading placeholders
  const displayResults = loading ? placeholderResults : searchResults;
  const showResults = loading || searchResults.length > 0;

  const showEmptyState = !hasSearched && !loading;
  const showNoResults = hasSearched && !loading && searchResults.length === 0;

  // Set default values for SkeletonContainer props to avoid using defaultProps
  const skeletonBgColor = greys(theme)[800];
  const skeletonHighlightColor = greys(theme)[600];
  const skeletonSpeed = 800;
  const skeletonAnimation = loading ? 'pulse' : 'none';

  return (
    <SafeAreaView
      style={{
        backgroundColor: greys(theme)[950],
        flex: 1,
      }}>
      <SkeletonContainer
        backgroundColor={skeletonBgColor}
        highlightColor={skeletonHighlightColor}
        speed={skeletonSpeed}
        animation={skeletonAnimation}>
        <Container contentContainerStyle={{ paddingHorizontal: 0, flex: 1 }}>
          <ScrollView
            style={{
              backgroundColor: greys(theme)[950],
            }}
            onScrollBeginDrag={handleScroll}
            scrollEventThrottle={16}>
            <View
              style={{
                backgroundColor: greys(theme)[950],
                paddingHorizontal: 16,
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}>
                {/* Wrapper View for TextInput with relative positioning */}
                <View style={{ flex: 1, position: 'relative' }}>
                  {/* Use React Native's TextInput directly instead of the custom component */}
                  <RNTextInput
                    ref={inputRef}
                    // autoFocus={true}
                    value={searchQuery}
                    onChangeText={handleSearchQueryChange}
                    placeholder="Search users..."
                    placeholderTextColor={greys(theme)[500]}
                    style={{
                      flex: 1,
                      paddingRight: 30,
                      backgroundColor: greys(theme)[800], // Add background color
                      borderRadius: 16, // Add border radius for styling
                      padding: 14, // Add padding
                      fontSize: 16,
                      fontFamily: 'OverpassRegular',
                      color: greys(theme)[0],
                    }}
                  />
                  {/* Clear button with absolute positioning */}
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={clearSearchInput}
                      style={{
                        position: 'absolute',
                        right: 0,
                        zIndex: 1,
                        padding: 14,
                      }}>
                      <Icon name="simple-line-icons:close" size={20} color={greys(theme)[50]} />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                  <Text
                    style={{
                      color: greys(theme)[50],
                      marginLeft: 12,
                      fontSize: 16,
                    }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>

              {showResults && (
                <View style={{ marginTop: 8 }}>
                  {/* Results count text - only shown when not loading */}
                  <View style={{ marginBottom: 12 }}>
                    <Text
                      loading={loading}
                      style={{
                        color: greys(theme)[400],
                        fontSize: 14,
                        fontFamily: 'OverpassBold',
                      }}>
                      Found {searchResults.length}{' '}
                      {searchResults.length === 1 ? 'result' : 'results'}
                    </Text>
                  </View>

                  {/* Map over actual results or placeholder results */}
                  {displayResults.map((result, index) => (
                    <SearchResult
                      key={`result-${index}`}
                      loading={loading}
                      result={result}
                      onPress={() =>
                        !loading &&
                        navigateToUserMessages({ pubkey: result.pubkey, profile: result.profile })
                      }
                    />
                  ))}
                </View>
              )}

              {/* Show EmptyStateView when no search has been attempted */}
              {showEmptyState && <EmptyStateView theme={theme} />}

              {/* Show NoResultsFound when search completed with no results */}
              {showNoResults && <NoResultsFound theme={theme} />}
            </View>
          </ScrollView>
        </Container>
      </SkeletonContainer>
    </SafeAreaView>
  );
}

function NoResultsFound({ theme }) {
  return (
    <View
      style={{
        marginTop: 40,
        alignItems: 'center',
        paddingHorizontal: 24,
      }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: greys(theme)[800],
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
        <Icon name="nonicons:error-16" size={40} color={greys(theme)[400]} />
      </View>

      <Text
        style={{
          color: greys(theme)[50],
          fontSize: 20,
          fontFamily: 'OverpassBold',
          marginBottom: 12,
          textAlign: 'center',
        }}>
        No Results Found
      </Text>

      <Text
        style={{
          color: greys(theme)[400],
          fontSize: 16,
          textAlign: 'center',
          marginBottom: 28,
        }}>
        {"We couldn't find any users matching your search"}
      </Text>

      <View
        style={{
          backgroundColor: greys(theme)[800],
          borderRadius: 12,
          padding: 16,
          width: '100%',
          marginBottom: 16,
        }}>
        <Text
          style={{
            color: greys(theme)[100],
            fontSize: 16,
            fontFamily: 'OverpassBold',
            marginBottom: 12,
          }}>
          Try adjusting your search:
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="lucide:pencil-line" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Check your spelling
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="solar:key-bold" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Try using a complete public key
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="mdi:at" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Use a different NIP-05 identifier
          </Text>
        </View>
      </View>
    </View>
  );
}

// New Component for Empty State
function EmptyStateView({ theme }) {
  return (
    <View
      style={{
        marginTop: 40,
        alignItems: 'center',
        paddingHorizontal: 24,
      }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: greys(theme)[800],
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
        <Icon name="majesticons:search-line" size={40} color={greys(theme)[400]} />
      </View>

      <Text
        style={{
          color: greys(theme)[50],
          fontSize: 20,
          fontFamily: 'OverpassBold',
          marginBottom: 12,
          textAlign: 'center',
        }}>
        Search for Users
      </Text>

      <Text
        style={{
          color: greys(theme)[400],
          fontSize: 16,
          textAlign: 'center',
          marginBottom: 28,
        }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      <View
        style={{
          backgroundColor: greys(theme)[800],
          borderRadius: 12,
          padding: 16,
          width: '100%',
          marginBottom: 16,
        }}>
        <Text
          style={{
            color: greys(theme)[100],
            fontSize: 16,
            fontFamily: 'OverpassBold',
            marginBottom: 4,
          }}>
          Search Tips:
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="ph:user-bold" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Search by username or display name
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="solar:key-bold" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Search by public key
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="mdi:at" size={20} color={greys(theme)[300]} />
          <Text style={{ color: greys(theme)[200], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Search by NIP-05 identifier
          </Text>
        </View>
      </View>
    </View>
  );
}

function SearchResult({ result, onPress, loading }) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        backgroundColor: greys(theme)[800],
        borderRadius: 8,
        marginBottom: 8,
      }}>
      <View style={{ marginRight: 8 }}>
        <ProfileImage loading={loading} profile={result?.profile} />
      </View>
      <View style={{ flex: 1 }}>
        <Text loading={loading} style={{ fontWeight: 'bold', color: greys(theme)[50] }}>
          {result?.profile?.displayName || result?.profile?.name}
        </Text>
        {result?.profile?.nip05 && (
          <Text
            loading={loading}
            style={{
              color: result?.profile?.nip05Valid ? greens[300] : reds[300],
              fontSize: 12,
            }}>
            {result?.profile?.nip05Valid ? '✓ ' : '✗ '}
            {result?.profile?.nip05}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function ProfileImage({ profile, loading }) {
  const theme = useSelector(memoizedGetTheme);
  const [imageError, setImageError] = useState(false);

  return (
    <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }}>
      {!loading && (
        <>
          {profile?.picture && !imageError ? (
            <Image
              source={{ uri: profile?.picture }}
              onError={() => {
                setImageError(true);
              }}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 1000,
              }}
            />
          ) : (
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: greys(theme)[950],
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon name="ph:user-bold" size={24} color={greys(theme)[400]} />
            </View>
          )}
        </>
      )}
    </Skeleton>
  );
}

export default withSheetProvider(ModalScreen);
