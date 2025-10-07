import React from 'react';
import { Text } from 'components/ui/Text';
import { View, HStack } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { Message } from 'redux/nostr';
import { useTheme } from 'providers/ThemeProvider';

const MessageComponent = ({ message, isReceived }: { message: Message; isReceived: boolean }) => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  return (
    <View
      className={`relative my-2 ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 60 }} // Ensure minimum height
    >
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          [isReceived ? 'left' : 'right']: 16,
          backgroundColor: isReceived ? getPrimaryColor('500') : getShadeColor('300'),
          transform: [{ rotate: '45deg' }],
        }}
      />
      <LinearGradient
        colors={
          isReceived
            ? [getShadeColor('200'), getShadeColor('300')]
            : [getShadeColor('200'), getShadeColor('300')]
        }
        style={{
          borderRadius: 16,
          padding: 16,
          maxWidth: '75%',
          minHeight: 50, // Ensure minimum height for content
        }}>
        <Text className="mb-2 text-base font-black text-primary-0">{message.content}</Text>
        <HStack className="justify-end">
          <Text className="text-xs font-bold text-primary-0 opacity-75">
            {message.created_at ? convertTime(new Date(message.created_at * 1000)) : 'Unknown time'}
          </Text>
        </HStack>
      </LinearGradient>
    </View>
  );
};

export default MessageComponent;
