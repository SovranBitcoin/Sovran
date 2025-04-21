import { View, ScrollView, Platform } from 'react-native';
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { greys, shades } from 'helper/colors';
import { Text } from 'components/common/Themed';
import { Easing, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import 'react-native-gesture-handler';
import { useNostr } from 'helper/redux/nostr';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Animated from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { EventKind } from '../../app/Profile';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Posts } from './posts';
// import ndk from "components/ndk";
import CachedImage from 'components/common/Image';
import ndk from 'components/ndk';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useRoute } from '@react-navigation/native';
dayjs.extend(relativeTime);

const myCache = new Cache({
  // maxSize: 100,
  namespace: 'posts',
  policy: {
    maxEntries: 100,
    stdTTL: 60 * 5,
  },
  backend: AsyncStorage,
});

export async function getFollowedUsers(userPubkey, verbose = true) {
  // Instantiate the user
  const user = ndk.getUser({ pubkey: userPubkey });

  user.follows().then((followedUsers) => {
    const follows = [];
    for (const followedUser of followedUsers) {
      if (verbose) {
        follows.push({
          pubkey: followedUser.pubkey,
          profile: followedUser.profile,
        });
      } else {
        follows.push(followedUser.pubkey);
      }
    }

    //
    return follows;
  });
}

export default function AboutPage(props) {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles } = useNostr();
  const { params } = useRoute();
  const [activeTab, setActiveTab] = useState(0);
  const p = [...search, ...profiles].find((p) => p.pubkey === params.pubkey);

  const [followed, setFollowed] = useState(0);
  const [followers, setFollowers] = useState(0);
  const fetchFollowing = async () => {
    const [f_, f2_] = await Promise.all([
      myCache.get(`${p.pubkey}.followers`),
      myCache.get(`${p.pubkey}.following`),
    ]);

    if (f_ && f2_) {
      setFollowers(Number(f_));
      setFollowed(Number(f2_));
    } else {
      ndk
        .fetchEvents({
          '#p': [p.pubkey],
          kinds: [EventKind.ContactList],
        })
        .then((events) => {
          let f = 0;
          for (const event of events) {
            f = f + 1;
          }

          setFollowers(f);

          getFollowedUsers(p.pubkey, false).then((result) => {
            if (result.length > 0) {
              setFollowed(result.length);
              myCache.set(`${p.pubkey}.following`, String(result.length));
            }
            myCache.set(`${p.pubkey}.followers`, String(f));
          });
        });
    }
  };

  // Underscore width and position shared values for animation
  const underscoreWidth = useSharedValue(0);
  const underscorePosition = useSharedValue(0);

  const TABS = ['Posts', 'Replies', 'Media'];
  // Refs to store tab item positions and widths
  const tabWidths = useState(Array(TABS.length).fill(0))[0];
  const tabOffsets = useState(Array(TABS.length).fill(0))[0];
  const animatedUnderscoreStyle = useAnimatedStyle(() => {
    return {
      width: withTiming(underscoreWidth.value, {
        duration: 200,
        easing: Easing.out(Easing.ease),
      }),
      transform: [
        {
          translateX: withTiming(underscorePosition.value, {
            duration: 200,
            easing: Easing.out(Easing.ease),
          }),
        },
      ],
    };
  });

  const handleTabPress = (index) => {
    setActiveTab(index);
    underscoreWidth.value = tabWidths[index];
    underscorePosition.value = tabOffsets[index];
  };

  const measureTab = (event, index) => {
    const { width, x } = event.nativeEvent.layout;
    tabWidths[index] = width;
    tabOffsets[index] = x;
    if (index === 0 && underscoreWidth.value === 0) {
      // Initialize underscore on first render
      underscoreWidth.value = width;
      underscorePosition.value = x;
    }
  };

  // useEffect(() => {
  //   fetchFollowing();
  // }, []);

  // filter={(c) => {
  //   const isComment = c?.tags?.some((s) => s[0] === "e");
  //   const isRepost = c.kind === EventKind.Repost;

  //   const { urls } = extractUrls(c.content);

  //

  //   if (!isComment && activeTab === 0) {
  //     return true;
  //   } else if (isComment && !isRepost && activeTab === 1) {
  //     return true;
  //   } else if (urls.length > 0 && activeTab === 2 && !isRepost) {
  //     return true;
  //   }
  //   return false;
  // switch(activeTab) {
  //   case 0: {
  //     return c?.tabs?.length === 0
  //   }
  //   case 1: {
  //   }
  //   case 2: {
  //   }
  //   default: {
  //     return c?.tabs?.length !== 0
  //   }
  // }
  //   return true;
  // }}

  return (
    <ScrollView
      style={{
        backgroundColor: greys(theme)[2300],
        height: '100%',
      }}
      {...props}>
      <CachedImage
        style={{
          position: 'absolute',
          width: '100%',
          height: 120,
          borderColor: greys(theme)[1300],
          backgroundColor: greys(theme)[1800],
          borderWidth: 0.2,
          marginBottom: 12,
          top: -48,
          transform: [{ scale: 2 }],
          opacity: 0.5,
        }}
        source={{ uri: p?.banner || p?.profile?.banner }}
      />

      <CachedImage
        style={{
          position: 'absolute',
          width: 72,
          height: 72,
          borderRadius: 1000,
          marginBottom: 0,
          borderColor: greys(theme)[2300],
          borderWidth: 3,
          top: 120 - 72 + 8,
          left: 16,
          transform: [{ scale: 2 }],
          opacity: 0.5,
        }}
        source={{ uri: p?.image || p?.profile?.image }}
      />
      <BlurView
        tint="prominent"
        intensity={Platform.OS === 'ios' ? 50 : 5}
        experimentalBlurMethod={'dimezisBlurView'}
        style={{
          position: 'absolute',
          width: '100%',
          height: 1000,
          marginBottom: 12,
          top: 120,
        }}></BlurView>

      <CachedImage
        style={{
          width: '100%',
          height: 120,
          backgroundColor: greys(theme)[1800],
          marginBottom: 12,
          zIndex: 0,
          borderColor: greys(theme)[2300],
          borderWidth: 2,
        }}
        source={{ uri: p?.banner || p?.profile?.banner }}
      />

      <View
        style={{
          padding: 16,
          paddingTop: 8,
          marginTop: -64,
          backgroundColor: 'transparent',
          // alignItems: "center",
        }}>
        <CachedImage
          style={{
            position: 'relative',
            width: 72,
            height: 72,
            borderRadius: 1000,
            marginBottom: 0,
            borderColor: greys(theme)[2300],
            borderWidth: 2,
            zIndex: 10000000,
          }}
          source={{ uri: p?.image || p?.profile?.image }}
        />
        <Text
          style={{
            fontFamily: 'OverpassHeavy',
            fontSize: 20,
            textAlign: 'left',
            color: greys(theme)[0],
            marginBottom: 4,
          }}>
          {p?.displayName ||
            p?.profile?.displayName ||
            p?.display_name ||
            p?.profile?.display_name ||
            p?.name ||
            p?.profile?.name}
        </Text>
        <Text
          style={{
            fontFamily: 'OverpassRegular',
            fontSize: 14,
            textAlign: 'left',
            alignSelf: 'left',
            color: greys(theme)[400],
          }}>
          {p?.about || p?.profile?.about}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            marginTop: 4,
          }}>
          <View
            style={{
              flexDirection: 'row',
            }}>
            <Text
              style={{
                fontFamily: 'OverpassRegular',
                fontSize: 14,
                textAlign: 'left',
                alignSelf: 'left',
                color: greys(theme)[400],
              }}>
              {followers}
            </Text>
            <Text
              style={{
                fontFamily: 'OverpassBold',
                fontSize: 14,
                textAlign: 'left',
                alignSelf: 'left',
                color: greys(theme)[700],
                marginLeft: 4,
              }}>
              Followers
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              marginLeft: 8,
            }}>
            <Text
              style={{
                fontFamily: 'OverpassRegular',
                fontSize: 14,
                textAlign: 'left',
                alignSelf: 'left',
                color: greys(theme)[400],
              }}>
              {followed}
            </Text>
            <Text
              style={{
                fontFamily: 'OverpassBold',
                fontSize: 14,
                textAlign: 'left',
                alignSelf: 'left',
                color: greys(theme)[700],
                marginLeft: 4,
              }}>
              Following
            </Text>
          </View>
        </View>
      </View>

      {/* Tab bar */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 16,
        }}>
        {TABS.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            onPress={() => handleTabPress(index)}
            onLayout={(event) => measureTab(event, index)}
            style={{ marginRight: 16, paddingBottom: 16 }}>
            <Text
              style={{
                fontFamily: 'OverpassBold',
                fontSize: 16,
                color: index === activeTab ? greys(theme)[0] : greys(theme)[700],
              }}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Animated underscore */}
      <Animated.View
        style={[
          {
            height: 2,
            backgroundColor: shades[300],
            marginBottom: 0,
          },
          animatedUnderscoreStyle,
        ]}
      />

      {/* Render Posts using FlatList */}

      <Posts
        authors={[params.pubkey]}
        kinds={[
          EventKind.TextNote,
          EventKind.Repost,
          30023, // Long-form content
        ]}
        type={
          activeTab === 0 ? 'posts' : activeTab === 1 ? 'replies' : activeTab === 2 ? 'media' : null
        }
        // filter={(c) => c.filter((v) => v.tags.some((t) => t[3] === "root"))}
      />
    </ScrollView>
  );
}
