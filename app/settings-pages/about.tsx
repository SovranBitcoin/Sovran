import React from 'react';
import { Button } from 'components/ui/Button';
import { Linking, ScrollView } from 'react-native';
import Icon from 'assets/icons';
import { Card } from 'components/ui/Card';
import Container from 'components/blocks/Container';
import { VStack } from 'components/ui/View/VStack';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';

type ChangelogItem = {
  title: string;
  description: string;
};

interface ChangelogSectionProps {
  title: string;
  items: ChangelogItem[];
  emoji: string;
}

export default function ModalScreen() {
  const ChangelogSection = ({ title, items, emoji }: ChangelogSectionProps) => (
    <VStack spacing={8} style={{ marginBottom: 16 }}>
      <Text className="text-primary-0" size={16} bold>
        {emoji} {title}
      </Text>
      <VStack spacing={6}>
        {items.map((item, index) => (
          <VStack key={index} style={{ paddingLeft: 12 }}>
            <Text
              className="text-primary-200"
              size={14}
              style={{
                lineHeight: 20,
              }}>
              •{' '}
              <Text style={{ fontWeight: '600' }} className="text-primary-0">
                {item.title}
              </Text>
              : {item.description}
            </Text>
          </VStack>
        ))}
      </VStack>
    </VStack>
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
          variant="info"
        />

        <Spacer size={20} />

        <VStack spacing={8} style={{ marginBottom: 20 }}>
          <Text
            className="text-primary-0"
            size={18}
            bold
            style={{
              textAlign: 'center',
            }}>
            {"What's New in Version 0.0.22 (1)"}
          </Text>

          <ChangelogSection title="Bug Fixes" items={changelogData.bugFixes} emoji="🐛" />

          <ChangelogSection title="New Features" items={changelogData.newFeatures} emoji="✨" />

          <ChangelogSection title="Improvements" items={changelogData.improvements} emoji="🔧" />
        </VStack>

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
