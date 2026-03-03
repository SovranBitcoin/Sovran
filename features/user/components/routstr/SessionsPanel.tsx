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
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import opacity from 'hex-color-opacity';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useRoutstrStore, RoutstrSession } from '@/shared/stores/profile/routstrStore';
import { getUsername } from '@/shared/lib/username';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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

  const slugParts = model.canonical_slug?.split('/') || [];
  let modelName = slugParts[1] || model.name;

  modelName = modelName.replace(/-\d{8}$/, '');

  if (model.name?.includes(':')) {
    const nameParts = model.name.split(':');
    if (nameParts.length > 1) {
      modelName = nameParts[1].trim();
    }
  }

  return modelName || modelId;
}

/**
 * Single row in the actions list (settings-style). Renders icon + label + chevron.
 */
const ActionRow: React.FC<{
  icon: string;
  label: string;
  onPress?: () => void;
  isFirst?: boolean;
}> = ({ icon, label, onPress, isFirst }) => {
  const [foreground, surfaceSecondary, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
  ] as const);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: surfaceSecondary,
        padding: 12,
        ...(!isFirst && { borderTopWidth: 1, borderTopColor: surfaceTertiary }),
      }}>
      <HStack align="center" spacing={8}>
        <Icon name={icon} size={18} color={foreground} />
        <Text size={16} className="text-foreground">
          {label}
        </Text>
        <View className="flex-1" />
        <Icon name="fa6-solid:chevron-right" size={14} color={opacity(foreground, 0.4)} />
      </HStack>
    </TouchableOpacity>
  );
};

const SessionItem: React.FC<{
  session: RoutstrSession;
  isCurrent: boolean;
  onPress: () => void;
}> = ({ session, isCurrent, onPress }) => {
  const [foreground, accent, surfaceSecondary] = useThemeColor([
    'foreground',
    'accent',
    'surface-secondary',
  ] as const);

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
            <Text weight="heavy" size={16} className="text-foreground" numberOfLines={1}>
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
          <Text size={10} className="text-shade-400">
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
  const [foreground, surface, surfaceTertiary, shade400] = useThemeColor([
    'foreground',
    'surface',
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
  const searchQuery = externalSearchQuery ?? internalSearchQuery;
  const translateX = useSharedValue(-width);
  const backdropOpacity = useSharedValue(0);
  const panStartX = useSharedValue(0);

  const sessions = getAllSessions();
  const currentSessionId = getCurrentSessionId();
  const balance = getBalance();
  const selectedModelId = getSelectedModel();
  const availableModels = useMemo(() => getCachedModels() || [], [getCachedModels]);

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

  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStartX.value = translateX.value;
    })
    .onUpdate((event) => {
      if (event.translationX < 0) {
        const newX = Math.max(panStartX.value + event.translationX, -width);
        translateX.value = newX;
        const progress = Math.abs(newX) / width;
        backdropOpacity.value = Math.max(0, 0.5 * (1 - progress));
      }
    })
    .onEnd((event) => {
      const threshold = width * 0.3;
      const velocity = event.velocityX;

      if (event.translationX < -threshold || velocity < -500) {
        translateX.value = withTiming(-width, ANIMATION_CONFIG);
        backdropOpacity.value = withTiming(0, ANIMATION_CONFIG);
        runOnJS(onClose)();
      } else {
        translateX.value = withTiming(0, ANIMATION_CONFIG);
        backdropOpacity.value = withTiming(0.5, ANIMATION_CONFIG);
      }
    });

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
                  paddingBottom: insets.bottom,
                  shadowColor: '#000',
                  shadowOffset: { width: 2, height: 0 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 8,
                },
                panelStyle,
              ]}>
              <VStack flex={1} className="px-4">
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
                      <View className="mb-4 overflow-hidden rounded-xl">
                        <ActionRow
                          icon="lucide:square-pen"
                          label="New Session"
                          onPress={handleNewSession}
                          isFirst
                        />
                        <ActionRow
                          icon="ic:round-refresh"
                          label="Refresh Balance"
                          onPress={onRefreshBalance}
                        />
                        <ActionRow icon="ph:coins" label="Top Up Balance" onPress={onTopUp} />
                        <ActionRow icon="mdi:robot" label="Switch Model" onPress={onSwitchModel} />
                      </View>
                      {filteredSessions.length > 0 && (
                        <Text
                          size={13}
                          medium
                          style={{
                            color: opacity(foreground, 0.5),
                            letterSpacing: 0.5,
                          }}
                          className="mb-2 ml-1 uppercase">
                          Sessions
                        </Text>
                      )}
                    </>
                  }
                  ListEmptyComponent={
                    searchQuery ? (
                      <VStack align="center" justify="center" className="pt-8">
                        <Text className="text-center" style={{ color: opacity(foreground, 0.4) }}>
                          No sessions found
                        </Text>
                      </VStack>
                    ) : null
                  }
                />

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
                      <VStack spacing={2} className="min-w-0 flex-1">
                        <Text
                          loading={isMetadataLoading}
                          placeholder="Username"
                          size={16}
                          bold
                          className="text-foreground"
                          numberOfLines={1}>
                          {username}
                        </Text>
                        <HStack align="center" justify="flex-start" spacing={4}>
                          <Icon
                            name="material-symbols:account-balance-wallet"
                            size={14}
                            color={shade400}
                          />
                          <Text overpass size={12} className="text-shade-400">
                            {formatBalance(balance)}
                          </Text>
                          <Spacer size={4} />
                          <Icon name="mdi:robot" size={14} color={shade400} />
                          <Text size={12} className="text-shade-400" numberOfLines={1}>
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
