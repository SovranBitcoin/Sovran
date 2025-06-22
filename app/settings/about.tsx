import React from 'react';
import { Button } from 'components/common/Button';
import { Linking, ScrollView, Text, View } from 'react-native';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Card } from 'components/common/Card';
import Container from 'components/layout/Container';
import { greys } from 'helper/colors';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  const ChangelogSection = ({ title, items, emoji }) => (
    <View style={{ marginBottom: 16 }}>
      <Text
        style={{
          fontSize: 16,
          fontWeight: 'bold',
          color: greys(theme)[0],
          marginBottom: 8,
        }}>
        {emoji} {title}
      </Text>
      {items.map((item, index) => (
        <View key={index} style={{ marginBottom: 6, paddingLeft: 12 }}>
          <Text
            style={{
              fontSize: 14,
              color: greys(theme)[400],
              lineHeight: 20,
            }}>
            • <Text style={{ fontWeight: '600', color: greys(theme)[0] }}>{item.title}</Text>:{' '}
            {item.description}
          </Text>
        </View>
      ))}
    </View>
  );

  const changelogData = {
    bugFixes: [
      {
        title: 'Duplicate Proofs Removed',
        description:
          "Eliminated duplicate proofs in wallets. This issue affected a small number of users, but if your balance appears lower, it's likely due to this correction removing the duplicates.",
      },
    ],
    newFeatures: [
      {
        title: 'Mint Audit Page',
        description: 'Added a new page for auditing mints',
      },
      {
        title: 'Mint Messaging',
        description:
          'Added a communication feature in the payments tab where you can message your mints directly',
      },
      {
        title: 'Experimental Features',
        description:
          'Added toggle for experimental features which include eSIM, VPNs, and Gift Cards, contact developer for more info on how to activate it.',
      },
    ],
    improvements: [
      {
        title: 'Enhanced Error Handling',
        description: 'Improved error messages when no Lightning route is found',
      },
      {
        title: 'Payment State Tracking',
        description:
          'Experimenting with enhanced payment state tracking that shows you exactly which step your ecash transaction is currently at',
      },
      {
        title: 'Auto Updating Mint Auditor',
        description: 'Once per day the mint auditor will update.',
      },
    ],
  };

  return (
    <Container>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Card
          message="Sovran is currently in Beta, please use with caution and don't put on more sats than you are willing to lose. If you discover any bugs please report them so we can improve it!"
          theme={theme}
          variant="info"
        />

        <View style={{ marginTop: 20, marginBottom: 20 }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: 'bold',
              color: greys(theme)[0],
              marginBottom: 8,
              textAlign: 'center',
            }}>
            {"What's New in Version 0.0.22 (1)"}
          </Text>

          <ChangelogSection title="Bug Fixes" items={changelogData.bugFixes} emoji="🐛" />

          <ChangelogSection title="New Features" items={changelogData.newFeatures} emoji="✨" />

          <ChangelogSection title="Improvements" items={changelogData.improvements} emoji="🔧" />
        </View>

        <Button
          variant="secondary"
          onPress={() => {
            Linking.openURL('https://x.com/SovranBitcoin');
          }}
          text={'Follow us on X'}
          icon={<Icon name="hugeicons:new-twitter" />}
        />
      </ScrollView>
    </Container>
  );
}
