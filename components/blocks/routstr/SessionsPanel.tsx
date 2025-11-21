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

import React, { useCallback, useState, useEffect } from 'react';
import {
  FlatList,
  ListRenderItem,
  Pressable,
  useWindowDimensions,
  Keyboard,
  TextInput as RNTextInput,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { HStack, VStack, Spacer, View } from 'components/ui/View';
import { useTheme } from '@/providers/ThemeProvider';
import { useRoutstrStore, RoutstrSession } from 'stores/routstrStore';

interface SessionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onNewSession?: () => void;
}

const ANIMATION_CONFIG = {
  duration: 300,
};

const SessionItem: React.FC<{
  session: RoutstrSession;
  isCurrent: boolean;
  onPress: () => void;
}> = ({ session, isCurrent, onPress }) => {
  const { getPrimaryColor } = useTheme();

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
        backgroundColor: isCurrent ? getPrimaryColor('700') : getPrimaryColor('800'),
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderWidth: isCurrent ? 2 : 1,
        borderColor: isCurrent ? getPrimaryColor('400') : getPrimaryColor('700'),
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
          <Text size={10} style={{ color: getPrimaryColor('500') }}>
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
  const { getPrimaryColor } = useTheme();
  const { getAllSessions, getCurrentSessionId, switchSession, createSession } = useRoutstrStore();

  const [searchQuery, setSearchQuery] = useState('');
  const translateX = useSharedValue(-width);
  const backdropOpacity = useSharedValue(0);

  const sessions = getAllSessions();
  const currentSessionId = getCurrentSessionId();

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
      // Clear search when closing
      setSearchQuery('');
      Keyboard.dismiss();
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

  // Animated styles
  const panelStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    return {
      opacity: backdropOpacity.value,
      pointerEvents: isOpen ? 'auto' : 'none',
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
            backgroundColor: getPrimaryColor('900'),
            zIndex: 1000,
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
        <VStack flex={1} style={{ paddingHorizontal: 16 }}>
          <Spacer size={16} />

          {/* Search Bar */}
          <HStack align="center" spacing={12} style={{ marginBottom: 16 }}>
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
              <Icon name="majesticons:search-line" size={20} color={getPrimaryColor('400')} />
              <RNTextInput
                style={{
                  flex: 1,
                  marginLeft: 8,
                  color: getPrimaryColor('0'),
                  fontSize: 16,
                }}
                placeholder="Search"
                placeholderTextColor={getPrimaryColor('500')}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
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
          </HStack>

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
                      <Icon name="lucide:square-pen" size={20} color={getPrimaryColor('0')} />
                      <Text weight="heavy" size={16} style={{ color: getPrimaryColor('0') }}>
                        New Session
                      </Text>
                    </HStack>
                  </TouchableOpacity>
                </>
              )}
            </VStack>
          ) : (
            <FlatList
              data={filteredSessions}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            />
          )}
        </VStack>
      </Animated.View>
    </>
  );
};
