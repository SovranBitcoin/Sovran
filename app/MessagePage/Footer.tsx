import React from 'react';
import { StyleSheet } from 'react-native';
import { HStack } from 'components/common/View';
import Icon from 'assets/icons';
import TextInput from 'components/common/TextInput';
import { Button } from 'components/common/Button';

interface FooterProps {
  message: string;
  setMessage: (text: string) => void;
  handleSendDM: () => void;
}

const Footer = ({ message, setMessage, handleSendDM }: FooterProps) => {
  const styles = createStyles();

  return (
    <HStack align="center" spacing={8} style={styles.inputContainer}>
      <TextInput
        placeholder="Type your message..."
        value={message}
        onChangeText={setMessage}
        style={{
          padding: 12,
          marginLeft: 12,
          fontSize: 16,
          flex: 1,
        }}
      />

      <Button
        variant="secondary"
        icon={<Icon name="iconamoon:send-fill" />}
        onPress={handleSendDM}
        style={{
          width: 56,
          height: 56,
          marginRight: 8,
          paddingVertical: 0,
        }}
        noPadding
      />
    </HStack>
  );
};

const createStyles = () =>
  StyleSheet.create({
    inputContainer: {
      position: 'relative',
      backgroundColor: 'transparent',
    },
  });

export default Footer;
