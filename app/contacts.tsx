import React, { useRef, useState, useEffect } from 'react';
import { Image, ScrollView, Keyboard } from 'react-native';
import { useSelector } from 'react-redux';
import { greens, greys, reds, shades } from 'helper/colors';
import TextInput from 'components/common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { NDKUser, NDKUserProfile } from '@nostr-dev-kit/ndk';
import { SkeletonContainer, Skeleton } from 'react-native-skeleton-component';
import { View, Text } from 'components/common/Themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import { store } from 'helper/redux/store';
import { setSearch } from 'helper/redux/nostr';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const ref = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const navigation = useTypedNavigation();

  console.log(192873, JSON.stringify(navigation));

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
      const response = await fetch(
        `https://esim.sovran.cash/search?query=${encodeURIComponent(query)}&limit=10`
      );
      const data = await response.json();

      if (data.results && Array.isArray(data.results)) {
        const formattedResults = data.results.map((result: NDKUserProfile) => {
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

  return (
    <SafeAreaView
      style={{
        backgroundColor: greys(theme)[2300],
        flex: 1,
      }}>
      <SkeletonContainer
        backgroundColor={greys(theme)[1800]}
        highlightColor={greys(theme)[1300]}
        speed={800}
        animation={loading ? 'pulse' : 'none'}>
        <Container contentContainerStyle={{ paddingHorizontal: 0, flex: 1 }}>
          <ScrollView
            style={{
              backgroundColor: greys(theme)[2300],
            }}
            onScrollBeginDrag={handleScroll}
            scrollEventThrottle={16}>
            <View
              style={{
                backgroundColor: greys(theme)[2300],
                paddingHorizontal: 16,
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}>
                {/* Wrapper View for TextInput with relative positioning */}
                <View style={{ flex: 1, position: 'relative' }}>
                  <TextInput
                    ref={ref}
                    // autoFocus={true}
                    value={searchQuery}
                    onChangeText={handleSearchQueryChange}
                    placeholder="Search users..."
                    placeholderTextColor={greys(theme)[1000]}
                    style={{
                      flex: 1,
                      paddingRight: 30, // Add padding to make room for the clear button
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
                        padding: 10,
                      }}>
                      <Icon name="simple-line-icons:close" size={20} color={greys(theme)[100]} />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                  <Text
                    style={{
                      color: greys(theme)[100],
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
                        color: greys(theme)[700],
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
                      key={index}
                      loading={loading}
                      key={result?.pubkey}
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
          backgroundColor: greys(theme)[1800],
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
        <Icon name="nonicons:error-16" size={40} color={greys(theme)[700]} />
      </View>

      <Text
        style={{
          color: greys(theme)[100],
          fontSize: 20,
          fontFamily: 'OverpassBold',
          marginBottom: 12,
          textAlign: 'center',
        }}>
        No Results Found
      </Text>

      <Text
        style={{
          color: greys(theme)[700],
          fontSize: 16,
          textAlign: 'center',
          marginBottom: 28,
        }}>
        We couldn't find any users matching your search
      </Text>

      <View
        style={{
          backgroundColor: greys(theme)[1800],
          borderRadius: 12,
          padding: 16,
          width: '100%',
          marginBottom: 16,
        }}>
        <Text
          style={{
            color: greys(theme)[200],
            fontSize: 16,
            fontFamily: 'OverpassBold',
            marginBottom: 12,
          }}>
          Try adjusting your search:
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="lucide:pencil-line" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Check your spelling
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="solar:key-bold" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Try using a complete public key
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Icon name="mdi:at" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
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
          backgroundColor: greys(theme)[1800],
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
        <Icon name="majesticons:search-line" size={40} color={greys(theme)[700]} />
      </View>

      <Text
        style={{
          color: greys(theme)[100],
          fontSize: 20,
          fontFamily: 'OverpassBold',
          marginBottom: 12,
          textAlign: 'center',
        }}>
        Search for Users
      </Text>

      <Text
        style={{
          color: greys(theme)[700],
          fontSize: 16,
          textAlign: 'center',
          marginBottom: 28,
        }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      <View
        style={{
          backgroundColor: greys(theme)[1800],
          borderRadius: 12,
          padding: 16,
          width: '100%',
          marginBottom: 16,
        }}>
        <Text
          style={{
            color: greys(theme)[200],
            fontSize: 16,
            fontFamily: 'OverpassBold',
            marginBottom: 4,
          }}>
          Search Tips:
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="ph:user-bold" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Search by username or display name
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="solar:key-bold" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
            Search by public key
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Icon name="mdi:at" size={20} color={greys(theme)[600]} />
          <Text style={{ color: greys(theme)[400], fontSize: 14, flex: 1, paddingLeft: 8 }}>
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
        backgroundColor: greys(theme)[1800],
        borderRadius: 8,
        marginBottom: 8,
      }}>
      <View style={{ marginRight: 8 }}>
        <ProfileImage loading={loading} profile={result?.profile} />
      </View>
      <View style={{ flex: 1 }}>
        <Text loading={loading} style={{ fontWeight: 'bold', color: greys(theme)[100] }}>
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

function ProfileImage({ profile, loading }: { profile: NDKUserProfile; loading?: boolean }) {
  const theme = useSelector(memoizedGetTheme);
  const [imageError, setImageError] = useState(false);

  return (
    <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }}>
      {!loading && (
        <>
          {profile?.picture && !imageError ? (
            <Image
              source={{ uri: profile?.picture }}
              onError={(e) => {
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
                backgroundColor: greys(theme)[2300],
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon name="ph:user-bold" size={24} color={greys(theme)[700]} />
            </View>
          )}
        </>
      )}
    </Skeleton>
  );
}
