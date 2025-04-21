import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, ScrollView, ActivityIndicator, Keyboard } from 'react-native'; // Added Keyboard import
import { useDispatch, useSelector } from 'react-redux';
import { greys, shades } from 'helper/colors';
import TextInput from 'components/common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import NDK, { NDKEvent, NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk';
import Icon from 'assets/icons';

export function useNDK() {
  const [ndk, setNDK] = useState<NDK | null>(null);
  const { signer } = useSigner();

  useEffect(() => {
    const initNDK = async () => {
      const newNDK = new NDK({
        explicitRelayUrls: [
          'wss://relay.damus.io',
          'wss://relay.snort.social',
          'wss://nos.lol',
          'wss://relay.nostr.band',
        ],
        signer,
      });

      await newNDK.connect();
      setNDK(newNDK);
    };

    if (signer) {
      initNDK();
    }
  }, [signer]);

  return { ndk };
}

import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { appendQuery, setSearch } from 'helper/redux/nostr';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Container from 'components/layout/Container';

export function useSigner() {
  const [signer, setSigner] = useState<NDKPrivateKeySigner | null>(null);

  useEffect(() => {
    setSigner(
    );
  }, []);

  return { signer };
}

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const ref = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { ndk } = useNDK();
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false); // Loading state
  const navigation = useTypedNavigation();

  const dvmRelaySet = useCallback(() => {
    if (!ndk) return null;
    return NDKRelaySet.fromRelayUrls(['wss://relay.vertexlab.io'], ndk);
  }, [ndk]);

  const dispatch = useDispatch();
  const dvmSearch = useCallback(
    async (input: string) => {
      if (!ndk) return;

      const relaySet = dvmRelaySet();
      if (!relaySet) return;

      const req = new NDKEvent(ndk, {
        kind: 5315,
        tags: [['param', 'search', input]],
      });
      await req.sign();

      setLoading(true); // Set loading to true when search starts

      try {
        const sub = ndk.subscribe(
          [{ kinds: [6315, 7000], ...req.filter() }],
          { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY },
          relaySet,
          {
            onEvent: async (event) => {
              if (event.kind === 7000) {
                const statusTag = event.getMatchingTags('status')?.[0];
                const status = statusTag?.[2] ?? statusTag?.[1];
                if (status) {
                }
              }

              sub.stop();

              try {
                const records = JSON.parse(event.content);

                dispatch(
                  appendQuery({
                    query: input,
                    records,
                  })
                );

                const profilePromises = records
                  .filter((record: any) => record.pubkey)
                  .map(async (record: any) => {
                    try {
                      const user = ndk.getUser({ pubkey: record.pubkey });
                      const profile = await user.fetchProfile();

                      const newResults = [{ pubkey: profile?.pubkey, profile: profile }];
                      const uniqueResults = [
                        ...new Map(newResults.map((item) => [item.pubkey, item])).values(),
                      ];
                      dispatch(setSearch(uniqueResults));

                      return {
                        pubkey: record.pubkey,
                        profile,
                      };
                    } catch (e) {
                      console.error('Failed to fetch profile:', e);
                      return {
                        pubkey: record.pubkey,
                        profile: {
                          name: 'Anonymous',
                          about: '',
                        },
                      };
                    }
                  });

                const results = await Promise.all(profilePromises);
                setSearchResults(results.sort((a, b) => (b.rank || 0) - (a.rank || 0)));
              } catch (e) {
                console.log('Failed to parse results:', e);
              } finally {
                setLoading(false); // Set loading to false after processing results
              }
            },
            onEose: () => {
              req.publish(relaySet);
            },
          }
        );
        sub.start();
      } catch (e) {
        console.error(e);
        setLoading(false); // Set loading to false on error
      }
    },
    [ndk, setSearchResults]
  );

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearchQueryChange = (input: string) => {
    setSearchQuery(input);
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      if (input.trim()) {
        setSearchResults([]);

        dvmSearch(input);
      }
    }, 2000);
  };

  const handleScroll = () => {
    Keyboard.dismiss(); // Dismiss the keyboard when scrolling
  };

  return (
    <Container scroll={false} contentContainerStyle={{ paddingHorizontal: 0, flex: 1 }}>
      <ScrollView
        style={{
          backgroundColor: greys(theme)[2300],
        }}
        onScrollBeginDrag={handleScroll} // Dismiss keyboard on scroll
        scrollEventThrottle={16}>
        {/* Added ScrollView with onScroll */}
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
            <TextInput
              ref={ref}
              autoFocus={true}
              value={searchQuery}
              onChangeText={handleSearchQueryChange}
              placeholder=""
              placeholderTextColor={greys(theme)[1000]}
              style={{
                flex: 1,
              }}
            />
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
          {loading && ( // Show loading indicator when loading
            <ActivityIndicator size="large" color={shades[300]} style={{ marginTop: 16 }} />
          )}
          {searchResults.length > 0 &&
            !loading && ( // Only show results if not loading
              <View style={{ marginTop: 16 }}>
                {searchResults.map((result) => (
                  <TouchableOpacity
                    onPress={() => {
                      navigation.navigate('userMessages', {
                        pubkey: result.pubkey,
                      });
                    }}
                    key={result?.pubkey}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 8,
                      backgroundColor: greys(theme)[1800],
                      borderRadius: 8,
                      marginBottom: 8,
                    }}>
                    <View style={{ marginRight: 8 }}>
                      {result?.profile?.picture ? (
                        <Image
                          source={{ uri: result?.profile?.picture }}
                          style={{ width: 48, height: 48, borderRadius: 24 }}
                          onError={(e) => {
                            e.currentTarget.src = '';
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
                          <Icon
                            name="mdi:user"
                            className="h-6 w-6 text-purple-600 dark:text-purple-300"
                          />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: 'bold', color: greys(theme)[100] }}>
                        {result?.profile?.displayName || result?.profile?.name}
                      </Text>
                      {result?.profile?.nip05 && (
                        <Text style={{ color: shades[200], fontSize: 12 }}>
                          ✓ {result?.profile?.nip05}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
        </View>
      </ScrollView>
    </Container>
  );
}
