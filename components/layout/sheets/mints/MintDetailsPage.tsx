import React from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { Text } from 'components/common/Themed';
import { greens, greys } from 'helper/colors';
import Wrapper, { SheetButton } from '../wrapper';
import { Card } from 'components/common/Card';
import { truncateMiddle } from 'helper/strings';
import { RowButton, Section } from 'app/settings';
import { useSheetRouter } from 'react-native-actions-sheet';

const MintDetailPage = () => {
  // Mock theme for the example
  const theme = 'dark';
  const styles = createStyles(theme);

  const handleEmailPress = () => {
    Linking.openURL('mailto:support@minibits.cash');
  };

  const handleNostrPress = () => {
    // Handle nostr key press, e.g., copy to clipboard or navigate to a specific screen
    // For example, you might want to copy the Nostr key to clipboard
    // Clipboard.setString("npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv");
  };
  const router = useSheetRouter('mint');

  return (
    <Wrapper
      buttons={
        <>
          <SheetButton
            onPress={() => {
              router?.goBack();
            }}>
            Cancel
          </SheetButton>
        </>
      }>
      {/* Mint Header */}
      <View style={styles.headerContainer}>
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>M</Text>
          </View>
        </View>
        <Text style={styles.mintTitle}>Minibits mint</Text>
      </View>

      {/* Message Banner */}
      <Card
        theme={theme}
        variant="info"
        message="Minibits wallet mint. Minibits is an active research project in BETA, use at your own risk."
      />

      {/* Contact Section */}
      <Section title="Contact">
        <RowButton label="support@minibits.cash" onPress={handleEmailPress} />
        <RowButton
          label="@MinibitsCash"
          onPress={() => {
            Linking.openURL('https://x.com/MinibitsCash');
          }}
        />
        <RowButton
          label={truncateMiddle(
            'npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv',
            13
          )}
          onPress={handleNostrPress}
        />
      </Section>

      {/* Mint Details Section */}
      <Section title="MINT DETAILS">
        <RowButton
          label="URL"
          value="mint.minibits.cash"
          onPress={() => {
            // Handle URL press
          }}
        />
        <RowButton
          label="Nuts"
          value="View all"
          onPress={() => {
            // Handle nuts press
          }}
        />
        <RowButton label="Currency" value="SAT" />
        <RowButton
          label="Version"
          value="Nutshell/0.16.4"
          // onPress={() => {
          // Handle version press
          // }}
        />
      </Section>

      {/* Action Buttons */}
      <Section title="Actions">
        <RowButton
          label="Edit mint"
          textStyle={styles.actionText}
          style={styles.actionButton}
          onPress={() => {
            // Handle edit mint
          }}
        />
        <RowButton
          label="Delete mint"
          textStyle={styles.destructiveText}
          style={styles.destructiveButton}
          onPress={() => {
            // Handle delete mint
          }}
          isDanger
        />
        {/* <RowButton
          label="Cancel"
          textStyle={styles.actionText}
          style={styles.actionButton}
          onPress={() => {
            // Handle cancel
          }}
        /> */}
      </Section>
    </Wrapper>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    headerContainer: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    logoContainer: {
      marginBottom: 16,
    },
    logo: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#3f836d',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: {
      fontSize: 40,
      fontWeight: 'bold',
      color: '#ffffff',
    },
    mintTitle: {
      fontSize: 28,
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
    },
    actionButton: {
      backgroundColor: greens[500],
      borderRadius: 8,
      marginVertical: 4,
    },
    destructiveButton: {
      backgroundColor: '#D32F2F', // Red color for destructive action
      borderRadius: 8,
      marginVertical: 4,
    },
    actionText: {
      fontSize: 16,
      fontWeight: 'bold',
      color: greys(theme)[0],
      textAlign: 'center',
    },
    destructiveText: {
      fontSize: 16,
      fontWeight: 'bold',
      color: greys(theme)[0],
      textAlign: 'center',
    },
  });

export default MintDetailPage;
