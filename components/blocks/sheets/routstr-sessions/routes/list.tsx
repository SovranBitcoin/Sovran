/**
 * @fileoverview ListRoute - Sessions list with ability to switch and create new sessions
 *
 * @module components/blocks/sheets/routstr-sessions/routes/list
 *
 * @description
 * Displays all Routstr chat sessions with truncated first message previews.
 * Allows switching between sessions and creating new ones.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - Close: `sheetRef.current?.hide({payload: {sessionId: selectedSessionId}})`
 *
 * **Data:**
 * - Payload: None
 * - Params: None (initial route)
 *
 * **Flow:** Load sessions → display → user selects or creates new → close
 */

import React, { useCallback } from 'react';
import { useSheetRef } from 'react-native-actions-sheet';
import { FlatList, ListRenderItem } from 'react-native';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import Wrapper from '../../wrapper';
import { HStack, VStack, Spacer, View } from 'components/ui/View';
import { useTheme } from '@/providers/ThemeProvider';
import { useRoutstrStore, RoutstrSession } from 'stores/routstrStore';

interface SessionItemProps {
  session: RoutstrSession;
  isCurrent: boolean;
  onPress: () => void;
}

const SessionItem: React.FC<SessionItemProps> = ({ session, isCurrent, onPress }) => {
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
      className="bg-primary-800 rounded-lg p-4 mb-3"
      style={{
        borderWidth: isCurrent ? 2 : 1,
        borderColor: isCurrent ? getPrimaryColor('400') : getPrimaryColor('700'),
      }}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} spacing={4}>
          <HStack align="center" spacing={8}>
            <Text weight="heavy" size={16} className="text-primary-0" numberOfLines={1}>
              {session.title}
            </Text>
            {isCurrent && (
              <Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />
            )}
          </HStack>
          <Text size={12} className="text-primary-300" numberOfLines={2}>
            {session.messages.length > 0
              ? `${session.messages.length} message${session.messages.length !== 1 ? 's' : ''}`
              : 'No messages yet'}
          </Text>
          <Text size={10} className="text-primary-500">
            {formatDate(session.createdAt)}
          </Text>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
};

const ListRoute: React.FC = () => {
  const { getPrimaryColor } = useTheme();
  const sheetRef = useSheetRef();
  const { getAllSessions, getCurrentSessionId, createSession, switchSession } =
    useRoutstrStore();

  const sessions = getAllSessions();
  const currentSessionId = getCurrentSessionId();

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      switchSession(sessionId);
      sheetRef.current?.hide({ payload: { sessionId } });
    },
    [switchSession, sheetRef]
  );

  const handleNewSession = useCallback(() => {
    const newSessionId = createSession();
    sheetRef.current?.hide({ payload: { sessionId: newSessionId } });
  }, [createSession, sheetRef]);

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

  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 100, // Estimated item height
      offset: 100 * index,
      index,
    }),
    []
  );

  return (
    <Wrapper>
      <VStack flex={1} className="px-4">
        <Spacer size={16} />
        <HStack align="center" justify="space-between">
          <VStack flex={1}>
            <Text weight="heavy" size={24} className="text-primary-0">
              Sessions
            </Text>
            <Spacer size={4} />
            <Text size={14} className="text-primary-400">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </Text>
          </VStack>
          <TouchableOpacity
            onPress={handleNewSession}
            className="bg-primary-700 rounded-lg p-3"
            style={{ borderWidth: 1, borderColor: getPrimaryColor('600') }}>
            <HStack align="center" spacing={8}>
              <Icon name="lucide:square-pen" size={20} color={getPrimaryColor('0')} />
              <Text weight="heavy" size={14} className="text-primary-0">
                New
              </Text>
            </HStack>
          </TouchableOpacity>
        </HStack>
        <Spacer size={16} />

        {sessions.length === 0 ? (
          <VStack align="center" justify="center" flex={1}>
            <Icon name="lucide:square-pen" size={48} color={getPrimaryColor('500')} />
            <Spacer size={16} />
            <Text className="text-primary-400" textAlign="center">
              No sessions yet. Create your first session to get started!
            </Text>
            <Spacer size={24} />
            <TouchableOpacity
              onPress={handleNewSession}
              className="bg-primary-700 rounded-lg px-6 py-3"
              style={{ borderWidth: 1, borderColor: getPrimaryColor('600') }}>
              <HStack align="center" spacing={8}>
                <Icon name="lucide:square-pen" size={20} color={getPrimaryColor('0')} />
                <Text weight="heavy" size={16} className="text-primary-0">
                  New Session
                </Text>
              </HStack>
            </TouchableOpacity>
          </VStack>
        ) : (
          <FlatList
            data={sessions}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            removeClippedSubviews={true}
            initialNumToRender={10}
            windowSize={10}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        )}
      </VStack>
    </Wrapper>
  );
};

export default ListRoute;

