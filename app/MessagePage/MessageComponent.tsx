import React from 'react';
import { Text } from 'components/ui/Text';
import { StyleSheet } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
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
  const styles = createStyles(theme, isReceived);

  return (
    <View style={styles.wrapper}>
      <View style={styles.arrow}></View>
      <LinearGradient
        colors={
          isReceived
            ? [greys(theme)[500], greys(theme)[500]]
            : [theme.shades[200], theme.shades[300]]
        }
        style={styles.container}>
        <Text style={styles.text}>{message.content}</Text>
        <HStack style={styles.footer}>
          <Text style={styles.timestamp}>{convertTime(new Date(message.created_at * 1000))}</Text>
        </HStack>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme: Theme, isReceived: boolean) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: 8,
      position: 'relative',
      alignSelf: isReceived ? 'flex-start' : 'flex-end',
    },
    container: {
      padding: 16,
      borderRadius: 16,
      maxWidth: '75%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      [isReceived ? 'left' : 'right']: 16,
      width: 8,
      height: 8,
      backgroundColor: isReceived ? greys(theme)[500] : theme.shades[300],
      transform: [{ rotate: '45deg' }],
    },
    text: {
      fontFamily: 'OverpassHeavy',
      fontSize: 16,
      marginBottom: 8,
      color: greys(theme)[0],
    },
    footer: {
      justifyContent: 'flex-end',
    },
    timestamp: {
      color: greys(theme)[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
    },
  });

export default MessageComponent;
