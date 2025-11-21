/**
 * @fileoverview SessionsPanel - Animated side panel for Routstr session management
 *
 * @module components/blocks/routstr/SessionsPanel
 *
 * @description
 * A React Native Reanimated side panel that slides in from the left to display
 * and manage Routstr chat sessions. Includes search functionality, session list,
 * and new session creation.
 */

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import {
  FlatList,
  ListRenderItem,
  Pressable,
  useWindowDimensions,
  Keyboard,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { HStack, VStack, Spacer, View } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { useTheme } from '@/providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useRoutstrStore, RoutstrSession } from 'stores/routstrStore';
import { getUsername } from 'helper/username';
import {
  Host,
  TextField,
  Button,
  GlassEffectContainer,
  VStack as SwiftUIVStack,
  HStack as SwiftUIHStack,
} from '@expo/ui/swift-ui';
import {
  foregroundStyle,
  frame,
  padding,
  cornerRadius,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';

interface SessionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onNewSession?: () => void;
}

const ANIMATION_CONFIG = {
  duration: 300,
};

// Utility functions
function formatBalance(msats: number | null): string {
  if (msats === null) return 'Unknown';
  if (msats >= 1000) {
    return `${(msats / 1000).toFixed(0)} sats`;
  }
  return `${msats} msats`;
}

function extractModelName(modelId: string, availableModels: any[]): string {
  const model = availableModels.find((m) => m.id === modelId);
  if (!model) return modelId;

  // Try to extract from canonical_slug first
  const slugParts = model.canonical_slug?.split('/') || [];
  let modelName = slugParts[1] || model.name;

  // Remove date suffix if present
  modelName = modelName.replace(/-\d{8}$/, '');

  // If name includes provider prefix, extract just the model part
  if (model.name?.includes(':')) {
    const nameParts = model.name.split(':');
    if (nameParts.length > 1) {
      modelName = nameParts[1].trim();
    }
  }

  return modelName || modelId;
}

const SessionItem: React.FC<{
  session: RoutstrSession;
  isCurrent: boolean;
  onPress: () => void;
}> = ({ session, isCurrent, onPress }) => {
  const { getPrimaryColor, getShadeColor } = useTheme();

  // Format date/time
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: isCurrent ? getPrimaryColor('800') : getPrimaryColor('800'),
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderLeftWidth: isCurrent ? 3 : 0,
        borderLeftColor: isCurrent ? getPrimaryColor('500') : 'transparent',
      }}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} spacing={4}>
          <HStack align="center" spacing={8}>
            <Text
              weight="heavy"
              size={16}
              style={{ color: getPrimaryColor('0') }}
              numberOfLines={1}>
              {session.title}
            </Text>
            {isCurrent && <Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />}
          </HStack>
          <Text size={12} style={{ color: getPrimaryColor('300') }} numberOfLines={2}>
            {session.messages.length > 0
              ? `${session.messages.length} message${session.messages.length !== 1 ? 's' : ''}`
              : 'No messages yet'}
          </Text>
          <Text size={10} style={{ color: getShadeColor('400') }}>
            {formatDate(session.createdAt)}
          </Text>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
};

export const SessionsPanel: React.FC<SessionsPanelProps> = ({
  isOpen,
  onClose,
  onSessionSelect,
  onNewSession,
}) => {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { getPrimaryColor, getShadeColor } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();
  const {
    getAllSessions,
    getCurrentSessionId,
    switchSession,
    createSession,
    getBalance,
    getSelectedModel,
    getCachedModels,
  } = useRoutstrStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const translateX = useSharedValue(-width);
  const backdropOpacity = useSharedValue(0);
  const panStartX = useSharedValue(0);

  const sessions = getAllSessions();
  const currentSessionId = getCurrentSessionId();
  const balance = getBalance();
  const selectedModelId = getSelectedModel();
  const availableModels = useMemo(() => getCachedModels() || [], [getCachedModels]);

  // Fetch user metadata for profile display (current user, not Routstr)
  const userPubkey = nostrKeys?.pubkey;
  const metadataFilters = useMemo(
    () =>
      userPubkey
        ? [
            {
              authors: [userPubkey],
              kinds: [Metadata],
              limit: 1,
            },
          ]
        : null,
    [userPubkey]
  );

  const { events: metadataEvents, eose: metadataEose } = useSubscribe({
    filters: metadataFilters,
  });

  const userInfo = metadataEvents?.[0] ? JSON.parse(metadataEvents[0].content) : null;
  const username = userPubkey ? getUsername(userPubkey) : 'User';
  const userPicture = userInfo?.picture;
  const isMetadataLoading = !metadataEose;
  const selectedModelName = useMemo(() => {
    return extractModelName(selectedModelId, availableModels);
  }, [selectedModelId, availableModels]);

  // Filter sessions by search query
  const filteredSessions = sessions.filter((session) =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      translateX.value = withTiming(0, ANIMATION_CONFIG);
      backdropOpacity.value = withTiming(0.5, ANIMATION_CONFIG);
    } else {
      translateX.value = withTiming(-width, ANIMATION_CONFIG);
      backdropOpacity.value = withTiming(0, ANIMATION_CONFIG);
      // Clear search and reset focus when closing
      setSearchQuery('');
      setIsSearchFocused(false);
      Keyboard.dismiss();
    }
  }, [isOpen, width, translateX, backdropOpacity]);

  // Track keyboard visibility to infer search focus
  useEffect(() => {
    if (!isOpen) return;

    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setIsSearchFocused(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsSearchFocused(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isOpen]);

  // Also set focus when user starts typing
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (text.length > 0) {
      setIsSearchFocused(true);
    }
  }, []);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      switchSession(sessionId);
      onSessionSelect?.(sessionId);
      onClose();
    },
    [switchSession, onSessionSelect, onClose]
  );

  const handleNewSession = useCallback(() => {
    createSession();
    onNewSession?.();
    onClose();
  }, [createSession, onNewSession, onClose]);

  const handleBackdropPress = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setIsSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  const handleMenuButtonPress = useCallback(() => {
    if (isSearchFocused || searchQuery) {
      setIsSearchFocused(false);
      setSearchQuery('');
      Keyboard.dismiss();
    } else {
      onClose();
    }
  }, [isSearchFocused, searchQuery, onClose]);

  // Pan gesture handler for swipe-to-close
  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStartX.value = translateX.value;
    })
    .onUpdate((event) => {
      // Only allow leftward swipes (negative translationX)
      if (event.translationX < 0) {
        const newX = Math.max(panStartX.value + event.translationX, -width);
        translateX.value = newX;
        // Update backdrop opacity based on panel position
        const progress = Math.abs(newX) / width;
        backdropOpacity.value = Math.max(0, 0.5 * (1 - progress));
      }
    })
    .onEnd((event) => {
      const threshold = width * 0.3; // Close if swiped more than 30% of width
      const velocity = event.velocityX;

      if (event.translationX < -threshold || velocity < -500) {
        // Close panel
        translateX.value = withTiming(-width, ANIMATION_CONFIG);
        backdropOpacity.value = withTiming(0, ANIMATION_CONFIG);
        runOnJS(onClose)();
      } else {
        // Snap back
        translateX.value = withTiming(0, ANIMATION_CONFIG);
        backdropOpacity.value = withTiming(0.5, ANIMATION_CONFIG);
      }
    });

  // Animated styles
  const panelStyle = useAnimatedStyle(() => {
    const isFullyClosed = translateX.value === -width;
    return {
      transform: [{ translateX: translateX.value }],
      pointerEvents: isFullyClosed ? 'none' : 'auto',
    };
  });

  const panelContainerStyle = useAnimatedStyle(() => {
    const isFullyClosed = translateX.value === -width;
    return {
      pointerEvents: isFullyClosed ? 'none' : 'auto',
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    const isFullyClosed = translateX.value === -width;
    return {
      opacity: backdropOpacity.value,
      pointerEvents: isFullyClosed ? 'none' : 'auto',
    };
  });

  const renderItem: ListRenderItem<RoutstrSession> = useCallback(
    ({ item }) => (
      <SessionItem
        session={item}
        isCurrent={item.id === currentSessionId}
        onPress={() => handleSessionSelect(item.id)}
      />
    ),
    [currentSessionId, handleSessionSelect]
  );

  const keyExtractor = useCallback((item: RoutstrSession) => item.id, []);

  if (!isOpen && translateX.value === -width) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000',
            zIndex: 999,
          },
          backdropStyle,
        ]}>
        <Pressable style={{ flex: 1 }} onPress={handleBackdropPress} />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: width,
            zIndex: 1000,
          },
          panelContainerStyle,
        ]}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={panGesture}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: width,
                  backgroundColor: getPrimaryColor('900'),
                  paddingTop: insets.top,
                  paddingBottom: insets.bottom,
                  shadowColor: '#000',
                  shadowOffset: { width: 2, height: 0 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 8,
                },
                panelStyle,
              ]}>
              <VStack flex={1} style={{ paddingHorizontal: 16, paddingBottom: 0 }}>
                {/* Header with menu, search, and new session/clear button - Absolutely Positioned */}
                {Platform.OS === 'ios' ? (
                  <View
                    style={{
                      position: 'absolute',
                      // top: insets.top,
                      left: 16,
                      right: 16,
                      zIndex: 10,
                      paddingBottom: 8,
                    }}>
                    <Host matchContents={false} fixedSize={true} style={{ marginBottom: 0 }}>
                      <SwiftUIHStack
                        spacing={12}
                        alignment="center"
                        modifiers={[
                          frame({
                            width: width - 32,
                            height: 44,
                            alignment: 'leading',
                          }),
                        ]}>
                        {/* Menu/Close Button - Liquid Glass */}
                        {/* <GlassEffectContainer spacing={0}> */}
                        <Host
                          modifiers={[frame({ width: 44, height: 44, alignment: 'center' })]}
                          matchContents={false}
                          fixedSize={true}>
                          <Button
                            variant="plain"
                            systemImage={isSearchFocused ? 'xmark' : 'line.horizontal.3'}
                            onPress={handleMenuButtonPress}
                            modifiers={[
                              frame({
                                width: 44,
                                height: 44,
                                alignment: 'center',
                              }),
                              glassEffect({
                                shape: 'circle',
                              }),
                            ]}
                          />
                        </Host>
                        {/* </GlassEffectContainer> */}

                        {/* Search Bar - Flex to fill remaining space */}
                        <SwiftUIVStack
                          modifiers={[
                            // frame({
                            //   maxWidth: Infinity,
                            //   height: 44,
                            //   alignment: 'leading',
                            // }),
                            // background(getPrimaryColor('800')),
                            // cornerRadius(12),
                            // padding({ horizontal: 12, vertical: 10 }),
                            padding({ horizontal: 12, vertical: 10 }),
                            frame({ width: width - 44 * 2 - 64, height: 44, alignment: 'leading' }),
                            glassEffect(),
                          ]}>
                          <TextField
                            key={searchQuery}
                            defaultValue={searchQuery}
                            placeholder="Search"
                            onChangeText={handleSearchChange}
                            keyboardType="web-search"
                            autocorrection={false}
                            modifiers={[
                              foregroundStyle(getPrimaryColor('0')),
                              // glassEffect(),
                              // frame({
                              //   maxWidth: Infinity,
                              //   height: 44,
                              //   alignment: 'leading',
                              // }),
                              // padding({ horizontal: 12, vertical: 10 }),
                            ]}
                          />
                        </SwiftUIVStack>

                        {/* New Session / Clear Button */}
                        {searchQuery ? (
                          <Pressable
                            onPress={handleClearSearch}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 22,
                              backgroundColor: getPrimaryColor('800'),
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                            <Icon name="mdi:close" size={24} color={getPrimaryColor('0')} />
                          </Pressable>
                        ) : (
                          // <GlassEffectContainer spacing={0}>
                          <Host
                            matchContents={false}
                            fixedSize={true}
                            style={{ width: 44, height: 44 }}>
                            <Button
                              variant="plain"
                              systemImage="square.and.pencil"
                              onPress={handleNewSession}
                              modifiers={[
                                frame({
                                  width: 44,
                                  height: 44,
                                  alignment: 'center',
                                }),
                                glassEffect({
                                  shape: 'circle',
                                }),
                              ]}
                            />
                          </Host>
                          // </GlassEffectContainer>
                        )}
                      </SwiftUIHStack>
                    </Host>
                  </View>
                ) : (
                  <View
                    blur
                    blurIntensity={70}
                    blurTint="dark"
                    style={{
                      position: 'absolute',
                      top: insets.top,
                      left: 16,
                      right: 16,
                      zIndex: 10,
                      backgroundColor: getPrimaryColor('900'),
                      paddingBottom: 8,
                    }}>
                    <HStack align="center" spacing={12} style={{ marginBottom: 0 }}>
                      {/* Menu/Close Button */}
                      <Pressable
                        onPress={handleMenuButtonPress}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: getPrimaryColor('800'),
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <Icon
                          name={isSearchFocused ? 'mdi:close' : 'mdi:menu'}
                          size={24}
                          color={getPrimaryColor('0')}
                        />
                      </Pressable>

                      {/* Search Bar - Flex to fill remaining space */}
                      <View
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: getPrimaryColor('800'),
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                        }}>
                        <Icon
                          name="majesticons:search-line"
                          size={20}
                          color={getPrimaryColor('400')}
                        />
                        <Host
                          matchContents={false}
                          fixedSize={true}
                          style={{ flex: 1, marginLeft: 8 }}>
                          <TextField
                            key={searchQuery}
                            defaultValue={searchQuery}
                            placeholder="Search"
                            onChangeText={handleSearchChange}
                            keyboardType="web-search"
                            autocorrection={false}
                            modifiers={[foregroundStyle(getPrimaryColor('0'))]}
                          />
                        </Host>
                      </View>

                      {/* New Session / Clear Button */}
                      {searchQuery ? (
                        <Pressable
                          onPress={handleClearSearch}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: getPrimaryColor('800'),
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          <Icon name="mdi:close" size={24} color={getPrimaryColor('0')} />
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={handleNewSession}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: getPrimaryColor('700'),
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 1,
                            borderColor: getPrimaryColor('600'),
                          }}>
                          <Icon name="lucide:square-pen" size={20} color={getPrimaryColor('0')} />
                        </Pressable>
                      )}
                    </HStack>
                  </View>
                )}

                {/* Sessions List */}
                {filteredSessions.length === 0 ? (
                  <VStack align="center" justify="center" flex={1}>
                    <Icon name="lucide:square-pen" size={48} color={getPrimaryColor('500')} />
                    <Spacer size={16} />
                    <Text style={{ color: getPrimaryColor('400'), textAlign: 'center' }}>
                      {searchQuery
                        ? 'No sessions found'
                        : 'No sessions yet. Create your first session to get started!'}
                    </Text>
                    {!searchQuery && (
                      <>
                        <Spacer size={24} />
                        {Platform.OS === 'ios' ? (
                          <GlassEffectContainer spacing={0}>
                            <Host matchContents={false} fixedSize={true}>
                              <Button
                                variant="glass"
                                onPress={handleNewSession}
                                modifiers={[
                                  padding({ horizontal: 24, vertical: 12 }),
                                  cornerRadius(12),
                                  glassEffect({
                                    shape: 'capsule',
                                  }),
                                ]}>
                                New Session
                              </Button>
                            </Host>
                          </GlassEffectContainer>
                        ) : (
                          <TouchableOpacity
                            onPress={handleNewSession}
                            style={{
                              backgroundColor: getPrimaryColor('700'),
                              borderRadius: 12,
                              paddingHorizontal: 24,
                              paddingVertical: 12,
                              borderWidth: 1,
                              borderColor: getPrimaryColor('600'),
                            }}>
                            <HStack align="center" spacing={8}>
                              <Icon
                                name="lucide:square-pen"
                                size={20}
                                color={getPrimaryColor('0')}
                              />
                              <Text
                                weight="heavy"
                                size={16}
                                style={{ color: getPrimaryColor('0') }}>
                                New Session
                              </Text>
                            </HStack>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </VStack>
                ) : (
                  <FlatList
                    data={filteredSessions}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                      paddingTop: 64, // Space for absolutely positioned header (44px height + 8px padding)
                      paddingBottom: userPubkey ? 100 : 16, // Space for bottom profile section
                    }}
                  />
                )}

                {/* Profile Information at Bottom - Absolutely Positioned with Blur */}
                {userPubkey && (
                  <View
                    blur
                    blurIntensity={70}
                    blurTint="dark"
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      paddingTop: 16,
                      paddingBottom: insets.bottom,
                      paddingHorizontal: 16,
                      borderTopWidth: 1,
                      borderTopColor: getPrimaryColor('700'),
                      marginBottom: -insets.bottom,
                    }}>
                    <HStack align="center" spacing={12}>
                      <Avatar
                        size={40}
                        picture={userPicture}
                        seed={userPubkey}
                        name={username}
                        loading={isMetadataLoading}
                      />
                      <VStack spacing={2} style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          size={16}
                          bold
                          style={{
                            color: getPrimaryColor('0'),
                          }}
                          numberOfLines={1}>
                          {username}
                        </Text>
                        <HStack align="center" justify="flex-start" spacing={4}>
                          <Icon
                            name="material-symbols:account-balance-wallet"
                            size={14}
                            color={getShadeColor('400')}
                          />
                          <Text size={12} style={{ color: getShadeColor('400') }}>
                            {formatBalance(balance)}
                          </Text>
                          <Spacer size={4} />
                          <Icon name="mdi:robot" size={14} color={getShadeColor('400')} />
                          <Text size={12} style={{ color: getShadeColor('400') }} numberOfLines={1}>
                            {selectedModelName}
                          </Text>
                        </HStack>
                      </VStack>
                    </HStack>
                  </View>
                )}
              </VStack>
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      </Animated.View>
    </>
  );
};
