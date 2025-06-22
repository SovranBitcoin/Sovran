import React from 'react';
import { StyleSheet } from 'react-native';
import { View } from 'components/common/View';
import Icon from 'assets/icons';
import TextInput from 'components/common/TextInput';
import { Button } from 'components/common/Button';

const Footer = ({ theme, message, setMessage, handleSendDM, isFocused, setIsFocused }) => {
  const styles = createStyles(theme);

  return (
    <View style={styles.inputContainer}>
      <TextInput
        placeholder="Type your message..."
        value={message}
        onChangeText={setMessage}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          padding: 12,
          marginLeft: 12,
          marginRight: 8,
          // marginTop: 0,
          margin: 0,
          fontSize: 16,
          flex: 1,
        }}
      />

      <View>
        <Button
          variant="secondary"
          icon={<Icon name="iconamoon:send-fill" />}
          onPress={handleSendDM}
          style={{
            width: 56,
            height: 56,
            margin: 0,
            marginRight: 8,
            paddingVertical: 0,
            marginBottom: 0,
          }}
          noPadding></Button>
      </View>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    inputContainer: {
      position: 'relative',
      backgroundColor: 'transparent',
      flexDirection: 'row',
    },
    sendButton: {
      // position: "absolute",
      // right: 0,
      // bottom: 16,
      // height: "100%",
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 24,
      paddingRight: 8,
      backgroundColor: 'transparent',
    },
  });

export default Footer;
