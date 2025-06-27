import React from 'react';
import { Text } from 'components/common/Text';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { convertTime } from 'helper/time';
import { greys } from 'helper/colors';

const MessageComponent = ({ message, theme, isReceived }) => {
  const styles = createStyles(theme, isReceived);

  return (
    <View style={styles.wrapper}>
      <View style={styles.arrow}></View>
      <LinearGradient
        colors={isReceived ? [theme.greys[1000], theme.greys[1200]] : [theme.shades[100], theme.shades[300]]}
        style={styles.container}>
        <Text style={styles.text}>{message.content}</Text>
        <View style={styles.footer}>
          <Text style={styles.timestamp}>{convertTime(new Date(message.created_at * 1000))}</Text>
          {message.status && <Text style={styles.status}> • {message.status}</Text>}
        </View>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme, isReceived) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
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
      backgroundColor: isReceived ? theme.greys[1200] : theme.shades[300],
      transform: [{ rotate: '45deg' }],
    },
    text: {
      fontFamily: 'OverpassHeavy',
      fontSize: 16,
      marginBottom: 8,
      color: theme.greys[0],
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    timestamp: {
      color: theme.greys[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
    },
    status: {
      color: theme.greys[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      marginLeft: 4,
    },
  });

export default MessageComponent;
