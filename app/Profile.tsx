import React, { useState, useEffect, useRef, useMemo } from 'react';
import { nip19, SimplePool } from 'nostr-tools';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import Icon, { PlusIcon, QRIcon, ImportIcon, CheckIcon } from 'assets/icons';
import { setSearch, useNostr } from 'helper/redux/nostr';
import { greys } from 'helper/colors';
import { useDispatch, useSelector } from 'react-redux';
import { Text } from 'components/common/Text';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

import ActionSheet, {
  Route,
  RouteScreenProps,
  useSheetRouter,
  useSheetRouteParams,
  ActionSheetRef,
  SheetDefinition,
  registerSheet,
  RouteDefinition,
  SheetProps,
} from 'react-native-actions-sheet';
import TextInput from 'components/common/TextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Image from 'components/common/Image';
import { relays } from 'components/ndk';

const npubs = [];

export const EventKind = {
  Unknown: -1,
  Metadata: 0,
  TextNote: 1,
  RecommendServer: 2,
  ContactList: 3, // NIP-02
  DirectMessage: 4, // NIP-04
  Deletion: 5, // NIP-09
  Repost: 6, // NIP-18
  Reaction: 7, // NIP-25
  BadgeAward: 8, // NIP-58
  SnortSubscriptions: 1000, // NIP-XX
  Polls: 6969, // NIP-69
  FileHeader: 1063, // NIP-94
  Relays: 10002, // NIP-65 Relay List Metadata
  Ephemeral: 20_000,
  Auth: 22242, // NIP-42
  PubkeyLists: 30000, // NIP-51a
  NoteLists: 30001, // NIP-51b
  TagLists: 30002, // NIP-51c
  Badge: 30009, // NIP-58
  ProfileBadges: 30008, // NIP-58
  ZapRequest: 9734, // NIP 57
  ZapReceipt: 9735, // NIP 57
  HttpAuthentication: 27235, // NIP XX - HTTP Authentication
} as const;

const Screen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const actionSheetRef = useRef<ActionSheetRef>(null);

  const { profiles, setProfiles, currentProfile, setCurrentProfile } = useNostr();
  const dispatch = useDispatch();
  const navigation = useTypedNavigation();

  useEffect(() => {
    const fetchProfiles = async () => {
      const pool = new SimplePool();
      const hexPubkeys = npubs.map((npub) => nip19.decode(npub).data);

      const sub = pool.subscribeMany(
        relays,
        [
          {
            authors: [String(hexPubkeys[1])],
            kinds: [EventKind.Metadata, EventKind.ContactList],
          },
          {
            authors: [String(hexPubkeys[0])],
            kinds: [EventKind.Metadata, EventKind.ContactList],
          },
        ],
        {
          onevent(event) {
            if (event.kind === EventKind.Metadata) {
              try {
                const content = JSON.parse(event.content);
                setProfiles(
                  [...profiles, { ...content, id: profiles.length, pubkey: event.pubkey }]
                    // remove duplicates
                    .filter(
                      (profile, index, self) =>
                        index === self.findIndex((p) => p.pubkey === profile.pubkey)
                    )
                );
                dispatch(
                  setSearch([
                    {
                      pubkey: event.pubkey,
                      profile: content,
                      internal: true,
                    },
                  ])
                );
              } catch (error) {}
            } else if (event.kind === EventKind.ContactList) {
              try {
                const contactPubkeys = event.tags
                  .filter((tag) => tag[0] === 'p')
                  .map((tag) => tag[1]);
                fetchContactProfiles(contactPubkeys);
              } catch (error) {}
            }
          },
        }
      );

      return () => {
        sub.close();
        pool.close(relays);
      };
    };

    const fetchContactProfiles = async (pubkeys) => {
      const pool = new SimplePool();
      const sub = pool.subscribeMany(
        relays,
        [
          {
            authors: [...new Set(pubkeys)],
            kinds: [EventKind.Metadata],
          },
        ],
        {
          onevent(event) {
            if (event.kind === EventKind.Metadata) {
              try {
                const content = JSON.parse(event.content);
              } catch (error) {}
            }
          },
        }
      );

      return () => {
        sub.close();
        pool.close(relays);
      };
    };

    fetchProfiles();
  }, []);

  function getName(profile) {
    const dn =
      profile?.profile?.displayName ||
      profile?.profile?.display_name ||
      profile?.profile?.username ||
      profile?.profile?.name ||
      '';
    return dn;
  }

  const profileIcons = profiles.slice(0).map((profile, i) => (
    <TouchableOpacity
      key={profile.pubkey}
      onPress={() => {
        setCurrentProfile({
          id: i,
          pubkey: profile.pubkey,
          ...profile,
        });
      }}
      style={styles.smallProfilePicture}>
      {profile?.picture && (
        <CachedImage
          source={{ uri: profile.picture }}
          style={{
            width: 32,
            height: 32,
          }}
        />
      )}
    </TouchableOpacity>
  ));

  // Add the camera icon at the end of the profile icons
  // check if there is a currentProfile
  // if (currentProfile?.pubkey) {
  //   profileIcons.push(
  //     <TouchableOpacity
  //       key="camera-icon"
  //       onPress={() => {
  //         navigation.navigate("onboard/welcome", {});
  //       }}
  //     >
  //       <View
  //         style={{
  //           borderRadius: 1000,
  //           padding: 8,
  //           backgroundColor: greys(theme)[1000],
  //         }}
  //       >
  //         <DotsIcon
  //           style={{
  //             width: 16,
  //             height: 16,
  //           }}
  //         />
  //       </View>
  //     </TouchableOpacity>
  //   );
  // }

  return (
    <>
      <ScrollView
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        style={{
          backgroundColor: greys(theme)[2100],
        }}>
        <LinearGradient
          colors={[
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            opacity(greys(theme)[2100], 0),
          ]}
          style={[styles.gradientContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}>
          <View
            style={{
              padding: 16,
              paddingTop: 0,
              paddingBottom: 58,
              flex: 1,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                marginBottom: 16,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              <View
                style={{
                  flexDirection: 'row',
                }}>
                {profileIcons}
              </View>
            </View>
            <TouchableOpacity
              style={{
                alignItems: 'center',
              }}
              onPress={() => {
                if (currentProfile?.pubkey) {
                  navigation.navigate('profileShare', {
                    npub:
                      profiles.find((profile) => profile.pubkey === currentProfile.pubkey)?.npub ||
                      nip19.npubEncode(
                        profiles.find((profile) => profile.pubkey === currentProfile.pubkey)?.pubkey
                      ),
                  });
                } else {
                  navigation.navigate('onboard');
                }
              }}>
              {currentProfile?.pubkey ? (
                <>
                  <CachedImage
                    source={{ uri: currentProfile.picture }}
                    style={styles.modalProfilePicture}
                  />
                  <Text weight="bold" size={20} style={styles.name}>
                    {getName(currentProfile)}
                  </Text>
                  <QRIcon
                    color={greys(theme)[0]}
                    style={{
                      width: 32,
                      height: 32,
                    }}
                  />
                </>
              ) : (
                <>
                  <View
                    style={{
                      borderRadius: 1000,
                      padding: 32,
                      backgroundColor: greys(theme)[2300],
                      borderColor: greys(theme)[1300],
                      borderWidth: 0.2,
                    }}>
                    <QRIcon
                      style={{
                        width: 32,
                        height: 32,
                      }}
                    />
                  </View>
                  <Text style={styles.name}>Create Account</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </LinearGradient>
        <View
          style={{
            marginTop: -16,
            paddingBottom: 48,
          }}>
          <Pressable
            onPress={() => {
              navigation.navigate('index', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:wallet-20-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Wallet
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              navigation.navigate('payments', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:arrow-swap-16-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Payments
            </Text>
          </Pressable>
          {/* <Pressable
            onPress={() => {
              navigation.navigate('myEsims', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:sim-24-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              eSIM
            </Text>
          </Pressable> */}
          {/* <Pressable
            onPress={() => {
              navigation.navigate('myVpns', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="ic:baseline-vpn-lock" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              VPN
            </Text>
          </Pressable> */}
          <Pressable
            onPress={() => {
              navigation.navigate('lifestyle', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon
              name="clarity:internet-of-things-solid"
              color={greys(theme)[0]}
              spin={{
                duration: 2000,
                delay: 4000,
                outputRange: ['0deg', '120deg'],
              }}
            />
            <Text size={18} weight="bold" style={styles.menuText}>
              Lifestyle
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              navigation.navigate('settings', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="material-symbols:settings-rounded" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Settings
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <ActionSheet
        ref={actionSheetRef}
        gestureEnabled={true}
        containerStyle={{
          backgroundColor: greys(theme)[2300],
        }}
        indicatorStyle={{
          backgroundColor: greys(theme)[1500],
        }}
        enableRouterBackNavigation={true}
        routes={routes}
        // isModal={false}
        initialRoute="route-a"
        springOffset={50}
        defaultOverlayOpacity={0.75}></ActionSheet>
    </>
  );
};

const RouteA = ({ router }: RouteScreenProps<'sheet-with-router', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const { profiles, setCurrentProfile, currentProfile } = useNostr();
  const navigation = useTypedNavigation();
  const styles = createStyles(theme);

  function getName(profile: any) {
    const dn =
      profile?.displayName || profile?.display_name || profile?.username || profile?.name || '';
    return dn;
  }

  return (
    <View style={styles.actionSheetContainer}>
      {profiles.map((profile: any, i: number) => (
        <TouchableOpacity
          key={profile.pubkey}
          style={[
            styles.profileItem,
            currentProfile?.pubkey === profile.pubkey && styles.selectedProfileItem,
          ]}
          onPress={async () => {
            setCurrentProfile({
              id: i,
              pubkey: profile.pubkey,
              ...profile,
            });
          }}
          onPressIn={() => {}}
          onPressOut={() => {}}>
          <CachedImage source={{ uri: profile.picture }} style={styles.actionSheetProfilePic} />
          <Text style={styles.profileName}>{getName(profile)}</Text>
          {currentProfile?.pubkey === profile.pubkey && (
            <View style={styles.checkIconContainer}>
              <CheckIcon color={greys(theme)[0]} style={{}} />
            </View>
          )}
        </TouchableOpacity>
      ))}
      <View style={styles.accountButtonsContainer}>
        <TouchableOpacity
          style={styles.createAccountButton}
          onPress={() => {
            navigation.navigate('onboard', {});
          }}
          onPressIn={() => {}}
          onPressOut={() => {}}>
          <PlusIcon style={styles.createAccountIcon} />
          <Text style={styles.createAccountText}>Create New Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.createAccountButton}
          onPress={() => {
            router.navigate('route-b');
          }}
          onPressIn={() => {}}
          onPressOut={() => {}}>
          <ImportIcon style={styles.createAccountIcon} />
          <Text style={styles.createAccountText}>Add Existing Account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const RouteB = () => {
  const router = useSheetRouter('sheet-with-router');
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={styles.actionSheetContainer}>
      <Text style={{ color: greys(theme)[0], fontSize: 16, marginBottom: 20 }}>
        Import your existing Nostr account
      </Text>

      <TouchableOpacity
        style={styles.importButton}
        onPress={() => {
          router?.navigate('route-c');
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Import from nsec</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.importButton}
        onPress={() => {
          router?.navigate('route-e');
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Import from npub (read only)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.importButton}
        onPress={() => {
          // Handle import logic
          router?.goBack();
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Import from seed phrase</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.importButton, { marginTop: 20 }]}
        onPress={() => {
          router?.goBack();
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const RouteC = () => {
  const router = useSheetRouter('sheet-with-router');
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState('');

  const filters = useMemo(
    () => [
      {
        // authors: [nsec ? nip19.decode(nsec).data : ""],
        kinds: [0],
        limit: 1,
      },
    ],
    [nsec]
  );

  const mintsFilters = useMemo(
    () => [
      {
        // authors: [nsec ? nip19.decode(nsec).data : ""],
        kinds: [37375],
        limit: 1,
      },
    ],
    [nsec]
  );

  const { events } = useSubscribe({ filters });
  const { events: mintsEvents } = useSubscribe({ filters: mintsFilters });

  const firstEvent = events[0];
  const mintsEvent = mintsEvents[0];

  const handleImport = () => {
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type === 'nsec') {
        const pubkey = decoded.data;
        const npub = nip19.npubEncode(pubkey);

        const hasEcash = mintsEvent?.tags?.some((tag) => tag[0] === 'mint');

        if (router) {
          router.navigate('route-d', {
            pubkey,
            npub,
            metadata: firstEvent ? JSON.stringify(firstEvent, null, 2) : 'No metadata found',
            tags: hasEcash ? ['Ecash enabled'] : [],
          });
        }
      } else {
        setError('Invalid nsec key');
      }
    } catch (e) {
      setError('Invalid nsec key');
    }
  };

  return (
    <View style={styles.actionSheetContainer}>
      <Text style={{ color: greys(theme)[0], fontSize: 16, marginBottom: 20 }}>
        Enter your nsec key
      </Text>

      <TextInput
        style={styles.input}
        placeholder="nsec1..."
        value={nsec}
        onChangeText={(text: string) => {
          setNsec(text);
          setError('');
        }}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.importButton, { marginTop: 20 }]}
        onPress={handleImport}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Import</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.importButton, { marginTop: 12 }]}
        onPress={() => {
          if (router) {
            router.goBack();
          }
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const RouteD = () => {
  const params = useSheetRouteParams<'sheet-with-router', 'route-d'>();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { profiles, setProfiles } = useNostr();

  const profileData = useMemo(() => {
    try {
      const parsed = JSON.parse(params.metadata || '{}');
      return parsed.content ? JSON.parse(parsed.content) : parsed;
    } catch (e) {
      return {};
    }
  }, [params.metadata]);

  const followerCount = useMemo(() => {
    if (!params.followList?.[0]?.tags) return 0;
    return params.followList[0].tags.filter((tag) => tag[0] === 'p').length;
  }, [params.followList]);

  const { name, display_name, website, picture, banner } = profileData;

  return (
    <View style={styles.actionSheetContainer}>
      <View style={styles.bannerContainer}>
        {banner ? (
          <Image source={{ uri: banner }} style={styles.bannerImage} resizeMode="cover" />
        ) : (
          <View style={[styles.bannerImage, { backgroundColor: greys(theme)[1500] }]} />
        )}
        <View style={styles.profileInfoContainer}>
          {picture ? (
            <Image source={{ uri: picture }} style={styles.profilePicture} />
          ) : (
            <View style={[styles.profilePicture, styles.defaultProfilePicture]}>
              <Text style={styles.defaultProfileInitial}>
                {(display_name || name || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.followerCount}>{followerCount} followers</Text>
        </View>
      </View>

      <View style={styles.nameContainer}>
        <Text style={styles.displayName}>{display_name || name || 'Anonymous User'}</Text>
        <Text style={styles.npub} numberOfLines={1} ellipsizeMode="middle">
          {params.npub}
        </Text>
        {website && (
          <TouchableOpacity>
            <Text style={styles.website}>{website}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.tagsContainer}>
          {params.tags?.map((tag, index) => (
            <View key={index} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
          {params.isReadOnly && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>Read only</Text>
            </View>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={styles.continueButton}
        onPress={() => {
          const accountIndex = profiles.length;
          setProfiles([
            ...profiles,
            {
              ...profileData,
              picture,
              pubkey: params.pubkey,
              npub: params.npub,
              // nsec,
              // mnemonic,
              id: accountIndex,
            },
          ]);
        }}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
};

const RouteE = () => {
  const router = useSheetRouter('sheet-with-router');
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [npub, setNpub] = useState('');
  const [error, setError] = useState('');

  const filters = useMemo(
    () => [
      {
        authors: [npub ? nip19.decode(npub).data : ''],
        kinds: [0],
        limit: 1,
      },
    ],
    [npub]
  );

  const mintsFilters = useMemo(
    () => [
      {
        authors: [npub ? nip19.decode(npub).data : ''],
        kinds: [37375],
        limit: 1,
      },
    ],
    [npub]
  );

  const followList = useMemo(
    () => [
      {
        authors: [npub ? nip19.decode(npub).data : ''],
        kinds: [3],
        limit: 1,
      },
    ],
    []
  );

  const { events } = useSubscribe({ filters });
  const { events: mintsEvents } = useSubscribe({ filters: mintsFilters });
  const { events: followListEvents } = useSubscribe({ filters: followList });

  const firstEvent = events[0];
  const mintsEvent = mintsEvents[0];
  const followListEvent = followListEvents;

  const handleImport = () => {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        const pubkey = decoded.data;

        const hasEcash = mintsEvent?.tags?.some((tag) => tag[0] === 'mint');
        const tags = hasEcash ? ['Ecash enabled'] : [];

        router?.navigate('route-d', {
          pubkey,
          npub,
          metadata: firstEvent ? JSON.stringify(firstEvent, null, 2) : 'No metadata found',
          tags,
          isReadOnly: true,
          followList: followListEvent,
        });
      } else {
        setError('Invalid npub key');
      }
    } catch (e) {
      setError('Invalid npub key');
    }
  };

  return (
    <View style={styles.actionSheetContainer}>
      <Text style={{ color: greys(theme)[0], fontSize: 16, marginBottom: 20 }}>
        Enter npub key for read-only access
      </Text>

      <TextInput
        style={styles.input}
        placeholder="npub1..."
        value={npub}
        onChangeText={(text: string) => {
          setNpub(text);
          setError('');
        }}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.importButton, { marginTop: 20 }]}
        onPress={handleImport}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Import</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.importButton, { marginTop: 12 }]}
        onPress={() => {
          router?.goBack();
        }}
        onPressIn={() => {}}
        onPressOut={() => {}}>
        <Text style={styles.importButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const routes: Route[] = [
  {
    name: 'route-a',
    component: RouteA,
  },
  {
    name: 'route-b',
    component: RouteB,
  },
  {
    name: 'route-c',
    component: RouteC,
  },
  {
    name: 'route-d',
    component: RouteD,
  },
  {
    name: 'route-e',
    component: RouteE,
  },
];

function SheetWithRouter(props: SheetProps) {
  const insets = useSafeAreaInsets();

  return <ActionSheet enableRouterBackNavigation={true} routes={routes} initialRoute="route-a" />;
}

registerSheet('sheet-with-router', SheetWithRouter);

declare module 'react-native-actions-sheet' {
  interface Sheets {
    'sheet-with-router': SheetDefinition<{
      routes: {
        'route-a': RouteDefinition;
        'route-b': RouteDefinition<{
          data: string;
        }>;
        'route-c': RouteDefinition;
        'route-d': RouteDefinition<{
          pubkey: string;
          npub: string;
          tags?: string[];
          isReadOnly?: boolean;
        }>;
        'route-e': RouteDefinition;
      };
    }>;
  }
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    smallProfilePicture: {
      width: 32,
      height: 32,
      borderRadius: 16,
      marginRight: 8,
      backgroundColor: greys(theme)[1500],
      overflow: 'hidden',
    },
    modalProfilePicture: {
      width: 64,
      height: 64,
      borderRadius: 32,
      marginBottom: 16,
      backgroundColor: greys(theme)[0],
    },
    name: {
      color: greys(theme)[0],
      marginBottom: 8,
      marginTop: 16,
      textAlign: 'center',
    },
    about: {
      fontSize: 16,
      color: greys(theme)[0],
      textAlign: 'center',
      marginBottom: 8,
    },
    website: {
      fontSize: 14,
      color: '#1e90ff',
      marginTop: 4,
    },
    contactContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    contactProfilePicture: {
      width: 32,
      height: 32,
      borderRadius: 16,
      marginBottom: 8,
    },
    contactName: {
      fontSize: 20,
      color: greys(theme)[0],
      textAlign: 'center',
    },
    qrText: {
      color: greys(theme)[0],
      fontSize: 24,
    },
    menuButton: {
      paddingTop: 0,
      paddingBottom: 32,
      padding: 32,
      justifyContent: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
    },
    menuText: {
      marginLeft: 12,
      color: greys(theme)[0],
    },
    gradientContainer: {
      padding: 16,
      paddingTop: 48,
      flex: 1,
    },
    container: {
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: greys(theme)[1500],
      backgroundColor: greys(theme)[1800],
      padding: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      margin: 16,
    },
    iconRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    iconContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: greys(theme)[1500],
      borderCurve: 'continuous',
    },
    iconLabel: {
      color: 'white',
      marginTop: 8,
      fontSize: 12,
      textAlign: 'center',
    },
    actionSheetContainer: {
      padding: 16,
      backgroundColor: greys(theme)[2300],
    },
    headerText: {
      color: greys(theme)[0],
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    subHeaderText: {
      color: greys(theme)[400],
      fontSize: 16,
      marginBottom: 24,
    },
    communitiesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 12,
    },
    communityBox: {
      width: '30%',
      aspectRatio: 1,
      backgroundColor: greys(theme)[1800],
      borderRadius: 12,
      padding: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    selectedCommunityBox: {
      borderColor: '#1e90ff',
      backgroundColor: opacity('#1e90ff', 0.1),
    },
    communityName: {
      color: greys(theme)[0],
      fontSize: 14,
      textAlign: 'center',
    },
    selectedCommunityText: {
      color: '#1e90ff',
      fontWeight: 'bold',
    },
    profileItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      // borderBottomWidth: 1,
      // borderBottomColor: greys(theme)[1800],
    },
    selectedProfileItem: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    actionSheetProfilePic: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 12,
    },
    profileName: {
      color: greys(theme)[0],
      fontSize: 16,
      flex: 1,
    },
    checkIconContainer: {
      marginLeft: 'auto',
      marginRight: 8,
    },
    accountButtonsContainer: {
      marginTop: 8,
    },
    createAccountButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      marginTop: 8,
    },
    createAccountIcon: {
      width: 24,
      height: 24,
      marginRight: 12,
    },
    createAccountText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    editButton: {
      padding: 8,
    },
    editButtonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    importButton: {
      padding: 16,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      marginBottom: 12,
      alignItems: 'center',
    },
    importButtonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    input: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      padding: 16,
      color: greys(theme)[0],
      fontSize: 16,
      marginBottom: 12,
    },
    errorText: {
      color: 'red',
      fontSize: 14,
      marginBottom: 12,
    },
    bannerContainer: {
      position: 'relative',
      marginBottom: 40,
    },
    bannerImage: {
      width: '100%',
      aspectRatio: 3,
      borderRadius: 12,
    },
    profileInfoContainer: {
      position: 'absolute',
      bottom: -40,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    profilePicture: {
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 4,
      borderColor: greys(theme)[2300],
    },
    followerCount: {
      color: greys(theme)[0],
      fontSize: 14,
      marginBottom: 8,
      marginRight: 8,
    },
    defaultProfilePicture: {
      backgroundColor: greys(theme)[1500],
      justifyContent: 'center',
      alignItems: 'center',
    },
    defaultProfileInitial: {
      color: greys(theme)[0],
      fontSize: 32,
      fontWeight: 'bold',
    },
    nameContainer: {
      marginHorizontal: 24,
    },
    displayName: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[0],
      marginBottom: 0,
    },
    npub: {
      fontSize: 14,
      color: greys(theme)[400],
      marginBottom: 4,
    },
    continueButton: {
      backgroundColor: '#1e90ff',
      padding: 16,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 16,
    },
    continueButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    tagsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
      gap: 8,
    },
    tag: {
      backgroundColor: greys(theme)[1800],
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
    },
    tagText: {
      color: greys(theme)[0],
      fontSize: 12,
    },
  });

export default withSheetProvider(Screen);
