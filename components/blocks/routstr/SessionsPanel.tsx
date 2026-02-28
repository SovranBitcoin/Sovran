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
import { FlatList, ListRenderItem, Pressable, useWindowDimensions } from 'react-native';
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
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Avatar } from 'components/ui/Avatar';
import opacity from 'hex-color-opacity';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useRoutstrStore, RoutstrSession } from 'stores/routstrStore';
import { getUsername } from 'helper/username';
import { useThemeColor } from 'hooks/useThemeColor';
interface SessionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onNewSession?: () => void;
  searchQuery?: string;
  onRefreshBalance?: () => void;
  onTopUp?: () => void;
  onSwitchModel?: () => void;
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
  const [foreground, accent, surfaceSecondary, shade400] = useThemeColor([
    'foreground',
    'accent',
    'surface-secondary',
    'shade-400',
  ] as const);

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
        backgroundColor: surfaceSecondary,
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderLeftWidth: isCurrent ? 3 : 0,
        borderLeftColor: isCurrent ? accent : 'transparent',
      }}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} spacing={4}>
          <HStack align="center" spacing={8}>
            <Text weight="heavy" size={16} style={{ color: foreground }} numberOfLines={1}>
              {session.title}
            </Text>
            {isCurrent && (
              <Icon name="mdi:check-circle" size={20} color={opacity(foreground, 0.4)} />
            )}
          </HStack>
          <Text size={12} style={{ color: opacity(foreground, 0.5) }} numberOfLines={2}>
            {session.messages.length > 0
              ? `${session.messages.length} message${session.messages.length !== 1 ? 's' : ''}`
              : 'No messages yet'}
          </Text>
          <Text size={10} style={{ color: shade400 }}>
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
  searchQuery: externalSearchQuery,
  onRefreshBalance,
  onTopUp,
  onSwitchModel,
}) => {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [foreground, surface, surfaceSecondary, surfaceTertiary, shade400] = useThemeColor([
    'foreground',
    'surface',
    'surface-secondary',
    'surface-tertiary',
    'shade-400',
  ] as const);
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

  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  // Use external search query from parent header when provided, otherwise use internal
  const searchQuery = externalSearchQuery ?? internalSearchQuery;
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
      // Clear internal search when closing
      setInternalSearchQuery('');
    }
  }, [isOpen, width, translateX, backdropOpacity]);

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
                  backgroundColor: surface,
                  paddingTop: 0,
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
                {/* Sessions List with Action Buttons */}
                <FlatList
                  data={filteredSessions}
                  renderItem={renderItem}
                  keyExtractor={keyExtractor}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingTop: 16,
                    paddingBottom: userPubkey ? 100 : 16,
                  }}
                  ListHeaderComponent={
                    <>
                      {/* Action Buttons (settings-style rows) */}
                      <View
                        style={{
                          borderRadius: 12,
                          overflow: 'hidden',
                          marginBottom: 16,
                        }}>
                        <TouchableOpacity
                          onPress={handleNewSession}
                          style={{
                            backgroundColor: surfaceSecondary,
                            padding: 12,
                            borderTopLeftRadius: 12,
                            borderTopRightRadius: 12,
                          }}>
                          <HStack align="center" spacing={8}>
                            <Icon name="lucide:square-pen" size={18} color={foreground} />
                            <Text size={16} style={{ color: foreground }}>
                              New Session
                            </Text>
                            <View style={{ flex: 1 }} />
                            <Icon
                              name="fa6-solid:chevron-right"
                              size={14}
                              color={opacity(foreground, 0.4)}
                            />
                          </HStack>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={onRefreshBalance}
                          style={{
                            backgroundColor: surfaceSecondary,
                            padding: 12,
                            borderTopWidth: 1,
                            borderTopColor: surfaceTertiary,
                          }}>
                          <HStack align="center" spacing={8}>
                            <Icon name="ic:round-refresh" size={18} color={foreground} />
                            <Text size={16} style={{ color: foreground }}>
                              Refresh Balance
                            </Text>
                            <View style={{ flex: 1 }} />
                            <Icon
                              name="fa6-solid:chevron-right"
                              size={14}
                              color={opacity(foreground, 0.4)}
                            />
                          </HStack>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={onTopUp}
                          style={{
                            backgroundColor: surfaceSecondary,
                            padding: 12,
                            borderTopWidth: 1,
                            borderTopColor: surfaceTertiary,
                          }}>
                          <HStack align="center" spacing={8}>
                            <Icon name="ph:coins" size={18} color={foreground} />
                            <Text size={16} style={{ color: foreground }}>
                              Top Up Balance
                            </Text>
                            <View style={{ flex: 1 }} />
                            <Icon
                              name="fa6-solid:chevron-right"
                              size={14}
                              color={opacity(foreground, 0.4)}
                            />
                          </HStack>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={onSwitchModel}
                          style={{
                            backgroundColor: surfaceSecondary,
                            padding: 12,
                            borderTopWidth: 1,
                            borderTopColor: surfaceTertiary,
                            borderBottomLeftRadius: 12,
                            borderBottomRightRadius: 12,
                          }}>
                          <HStack align="center" spacing={8}>
                            <Icon name="mdi:robot" size={18} color={foreground} />
                            <Text size={16} style={{ color: foreground }}>
                              Switch Model
                            </Text>
                            <View style={{ flex: 1 }} />
                            <Icon
                              name="fa6-solid:chevron-right"
                              size={14}
                              color={opacity(foreground, 0.4)}
                            />
                          </HStack>
                        </TouchableOpacity>
                      </View>
                      {/* Sessions section header */}
                      {filteredSessions.length > 0 && (
                        <Text
                          size={13}
                          medium
                          overpass
                          style={{
                            color: opacity(foreground, 0.5),
                            marginBottom: 8,
                            marginLeft: 4,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}>
                          Sessions
                        </Text>
                      )}
                    </>
                  }
                  ListEmptyComponent={
                    searchQuery ? (
                      <VStack align="center" justify="center" style={{ paddingTop: 32 }}>
                        <Text
                          style={{
                            color: opacity(foreground, 0.4),
                            textAlign: 'center',
                          }}>
                          No sessions found
                        </Text>
                      </VStack>
                    ) : null
                  }
                />

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
                      borderTopColor: surfaceTertiary,
                      marginBottom: -insets.bottom,
                    }}>
                    <HStack align="center" spacing={12}>
                      <Avatar
                        size={40}
                        picture={userPicture}
                        seed={userPubkey}
                        name={username}
                        variant="person"
                        loading={isMetadataLoading}
                      />
                      <VStack spacing={2} style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          size={16}
                          bold
                          style={{
                            color: foreground,
                          }}
                          numberOfLines={1}>
                          {username}
                        </Text>
                        <HStack align="center" justify="flex-start" spacing={4}>
                          <Icon
                            name="material-symbols:account-balance-wallet"
                            size={14}
                            color={shade400}
                          />
                          <Text size={12} style={{ color: shade400 }}>
                            {formatBalance(balance)}
                          </Text>
                          <Spacer size={4} />
                          <Icon name="mdi:robot" size={14} color={shade400} />
                          <Text size={12} style={{ color: shade400 }} numberOfLines={1}>
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
