import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import Container from 'components/layout/Container';
import { Card } from 'components/common/Card';
import { ButtonHandler } from 'components/common/ButtonHandler';

const ShowSeedPhrase: React.FC = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <Container>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mnemonic</Text>
        <Card message="Keep this private and secure!" variant="warning" />
        <TextInput
          style={[styles.textArea, !isVisible && styles.blurredText]}
          value={currentProfile?.mnemonic}
          editable={false}
          multiline
        />
        <ButtonHandler
          buttons={[
            {
              variant: 'primary',
              onPress: () => setIsVisible(!isVisible),
              text: isVisible ? 'Hide Mnemonic' : 'Show Mnemonic',
            },
          ]}
        />
      </View>
    </Container>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    section: {
      paddingVertical: 14,
    },
    sectionTitle: {
      margin: 10,
      marginLeft: 14,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: '500',
      color: greys(theme)[300],
      textTransform: 'uppercase',
    },
    textArea: {
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[800],
      color: greys(theme)[0],
      fontSize: 16,
      fontFamily: 'OverpassMono',
    },
    blurredText: {
      color: 'transparent',
      textShadowColor: greys(theme)[0],
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 8,
    },
    toggleButton: {
      marginTop: 12,
    },
  });

export default ShowSeedPhrase;
