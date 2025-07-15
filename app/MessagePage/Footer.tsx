import React from 'react';
import { StyleSheet } from 'react-native';
import { View } from 'components/common/View';
import Icon from 'assets/icons';
import TextInput from 'components/common/TextInput';
import { Button } from 'components/common/Button';
import { Theme } from 'helper/colors';

interface FooterProps {
  theme: Theme;
  message: string;
  setMessage: (text: string) => void;
  handleSendDM: () => void;
}

const Footer = ({ theme, message, setMessage, handleSendDM }: FooterProps) => {
  const styles = createStyles(theme);

  return (
    <View style={styles.inputContainer}>
      <TextInput
        placeholder="Type your message..."
        value={message}
        onChangeText={setMessage}
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

const createStyles = () =>
  StyleSheet.create({
    inputContainer: {
      position: 'relative',
      backgroundColor: 'transparent',
      flexDirection: 'row',
    },
    sendButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 24,
      paddingRight: 8,
      backgroundColor: 'transparent',
    },
  });

export default Footer;
