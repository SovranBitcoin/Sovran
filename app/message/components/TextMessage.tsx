import React from 'react';
import { Text } from 'components/ui/Text';
import { View, HStack } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { greys, Theme } from 'helper/colors';
import { Message } from 'helper/redux/nostr';

const MessageComponent = ({
  message,
  theme,
  isReceived,
}: {
  message: Message;
  theme: Theme;
  isReceived: boolean;
}) => {
  return (
    <View
      className={`relative my-2 ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 60 }} // Ensure minimum height
    >
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          [isReceived ? 'left' : 'right']: 16,
          backgroundColor: isReceived ? greys(theme)[500] : theme.shades[300],
          transform: [{ rotate: '45deg' }],
        }}
      />
      <LinearGradient
        colors={
          isReceived
            ? [greys(theme)[500], greys(theme)[500]]
            : [theme.shades[200], theme.shades[300]]
        }
        style={{
          borderRadius: 16,
          padding: 16,
          maxWidth: '75%',
          minHeight: 50, // Ensure minimum height for content
        }}>
        <Text className="mb-2 text-base font-black" style={{ color: greys(theme)[0] }}>
          {message.content}
        </Text>
        <HStack className="justify-end">
          <Text className="text-xs font-bold opacity-75" style={{ color: greys(theme)[0] }}>
            {message.created_at ? convertTime(new Date(message.created_at * 1000)) : 'Unknown time'}
          </Text>
        </HStack>
      </LinearGradient>
    </View>
  );
};

export default MessageComponent;
