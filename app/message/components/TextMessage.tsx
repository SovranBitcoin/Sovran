import React from 'react';
import { Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { Message } from 'redux/nostr';
import { useThemeColor } from '@/hooks/useThemeColor';

const MessageComponent = ({ message, isReceived }: { message: Message; isReceived: boolean }) => {
  const [accent, danger] = useThemeColor(['accent', 'danger'] as const);
  const brandGradient = useThemeColor(['shade-200', 'shade-300', 'shade-400'] as const);
  return (
    <View
      className={`relative my-2 ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 60 }}>
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          [isReceived ? 'left' : 'right']: 16,
          backgroundColor: isReceived ? accent : danger,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <LinearGradient
        colors={[brandGradient[0], brandGradient[1]]}
        style={{
          borderRadius: 16,
          padding: 16,
          maxWidth: '75%',
          minHeight: 50,
        }}>
        <Text className="text-foreground mb-2 text-base font-black">{message.content}</Text>
        <HStack className="justify-end">
          <Text className="text-foreground text-xs font-bold opacity-75">
            {message.created_at ? convertTime(new Date(message.created_at * 1000)) : 'Unknown time'}
          </Text>
        </HStack>
      </LinearGradient>
    </View>
  );
};

export default MessageComponent;
