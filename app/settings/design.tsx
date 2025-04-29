import React from 'react';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Card } from 'components/common/Card';
import Container from 'components/layout/Container';
import { Section as TableSection } from 'components/common/Section';
import { RowButton, Section } from '../settings';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { View } from 'components/common/Themed';
import { Tabs } from 'components/common/Tabs';
import CreditCardComponent from 'components/common/NFCCard';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <Container>
      <CreditCardComponent />

      {/* info message */}
      <Card
        message="Message"
        variant="info"
        onPress={() => {
          // this triggers onPress
        }}
      />
      {/* warning message */}
      <Card message="Message" variant="warning" />
      {/* this is a table view with two columns one for title and one for value */}
      <TableSection
        items={[
          {
            title: 'Title',
            value: 'Value',
          },
          {
            title: 'Title2',
            value: 'Value2',
          },
        ]}
      />

      {/* This is typically used in setting or configuration screens */}
      <Section title="Title">
        <RowButton label="Label" value={'Optional Value'} onPress={() => {}} />
        <RowButton label="Label" isDanger value={'Optional Value'} onPress={() => {}} />
      </Section>

      {/* This is usually added at the bottom of model pages, is shows 2 buttons at once, if 3 buttons are added then it will show a popup to show more options */}
      {/* you need to include this wrapper for now. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'transparent',
          paddingBottom: 8,
        }}>
        <ButtonHandler
          buttons={[
            {
              text: 'Button Text',
              icon: 'lets-icons:copy', // icon name from a library
              variant: 'primary',
              onPress: () => {},
            },
            {
              text: 'Button Text 2',
              icon: 'lets-icons:copy', // icon name from a library
              variant: 'secondary',
              onPress: () => {},
            },
          ]}></ButtonHandler>
      </View>

      <Tabs
        amounts={[0, 1, 200]}
        tabs={['Confirmed', 'Pending', 'Failed']}
        selectedTab={'Confirmed'}
        handleTabPress={() => {}}
      />
    </Container>
  );
}
