import React from 'react';
import { useSelector } from 'react-redux';
import { memoizedGetSettings } from 'redux/settings';
import { Card } from 'components/ui/Card';
import Container from 'components/blocks/Container';
import { Section as TableSection } from 'components/ui/Section';
import { RowButton, Section } from './index';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Tabs } from 'components/ui/Tabs';
import Icon, { icons } from 'assets/icons';
import { parseToHsl } from 'polished';
import { THEMES, useTheme } from 'providers/ThemeProvider';
import { Checkbox } from 'expo-checkbox';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { ScrollView } from 'react-native';

function chunkArray(array: any[], size: number) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export default function ModalScreen() {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const settings = useSelector(memoizedGetSettings);
  const [isChecked, setIsChecked] = React.useState(settings?.experimental);

  const toggleCheckbox = () => {
    const newValue = !isChecked;
    setIsChecked(newValue);
  };

  return (
    <Container>
      <ScrollView>
        <Text thin overpass size={16}>
          OverpassThin
        </Text>
        <Text extralight overpass size={16}>
          OverpassExtralight
        </Text>
        <Text light overpass size={16}>
          OverpassLight
        </Text>
        {/* Overpass Regular is the default if nothing is passed */}
        <Text regular overpass size={16}>
          OverpassRegular
        </Text>
        <Text semibold overpass size={16}>
          OverpassSemibold
        </Text>
        <Text bold overpass size={16}>
          OverpassBold
        </Text>
        <Text extrabold overpass size={16}>
          OverpassExtrabold
        </Text>
        <Text heavy overpass size={16}>
          OverpassHeavy
        </Text>
        <Spacer size={8} />

        <Text thin overpass italic size={16}>
          OverpassThinItalic
        </Text>
        <Text extralight overpass italic size={16}>
          OverpassExtralightItalic
        </Text>
        <Text light overpass italic size={16}>
          OverpassLightItalic
        </Text>
        <Text regular overpass italic size={16}>
          OverpassItalic
        </Text>
        <Text semibold overpass italic size={16}>
          OverpassSemiboldItalic
        </Text>
        <Text bold overpass italic size={16}>
          OverpassBoldItalic
        </Text>
        <Text extrabold overpass italic size={16}>
          OverpassExtraboldItalic
        </Text>
        <Text heavy overpass italic size={16}>
          OverpassHeavyItalic
        </Text>

        <Spacer size={8} />
        <Text mono overpass size={16}>
          OverpassMono
        </Text>

        <Spacer size={8} />

        {/* Lexend isn't really used in this project, only in onboarding flows */}
        <Text thin lexend size={16}>
          LexendThin
        </Text>
        <Text extralight lexend size={16}>
          LexendExtraLight
        </Text>
        <Text light lexend size={16}>
          LexendLight
        </Text>
        <Text regular lexend size={16}>
          LexendRegular
        </Text>
        <Text medium lexend size={16}>
          LexendMedium
        </Text>
        <Text semibold lexend size={16}>
          LexendSemiBold
        </Text>
        <Text bold lexend size={16}>
          LexendBold
        </Text>
        <Text extrabold lexend size={16}>
          LexendExtraBold
        </Text>
        <Text black lexend size={16}>
          LexendBlack
        </Text>

        {Object.keys(THEMES).map((theme) => {
          return (
            <View key={theme} className={`bg-primary-${theme} h-16`}>
              <Text>{(THEMES as any)[theme]}</Text>
              <Text>{JSON.stringify(parseToHsl((THEMES as any)[theme]))}</Text>
            </View>
          );
        })}

        <View className="h-8 w-8 bg-primary-950"></View>

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
          {/* Example with a custom right icon and label */}
          <RowButton
            label={
              <HStack align="center" spacing={8}>
                <Icon name="mingcute:lightning-fill" size={20} color={getPrimaryColor('400')} />
                <Text className="text-primary-50" bold>
                  npub1example@npubx.cash
                </Text>
              </HStack>
            }
            onPress={() => {}}
            rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
          />
        </Section>

        {/* This is usually added at the bottom of model pages, is shows 2 buttons at once, if 3 buttons are added then it will show a popup to show more options */}
        {/* you need to include this wrapper for now. */}
        <HStack justify="center" align="center" className="pb-2">
          <ButtonHandler
            buttons={[
              {
                text: 'Button Text',
                icon: 'lets-icons:copy', // icon name from a library
                variant: 'primary',
                onPress: async () => {},
              },
              {
                text: 'Button Text 2',
                icon: 'lets-icons:copy', // icon name from a library
                variant: 'secondary',
                onPress: async () => {},
              },
            ]}></ButtonHandler>
        </HStack>

        <Tabs
          amounts={['0', '1', '200']}
          tabs={['Confirmed', 'Pending', 'Failed']}
          selectedTab={'Confirmed'}
          handleTabPress={() => {}}
        />

        {/* Examples for different tab counts */}
        <VStack className="space-y-4" style={{ marginTop: 16 }}>
          {[1, 2, 3, 4, 5].map((count) => (
            <Tabs
              key={`example-tabs-${count}`}
              amounts={Array(count).fill(0)}
              tabs={Array.from({ length: count }, (_, i) => `Tab ${i + 1}`)}
              selectedTab={'Tab 1'}
              handleTabPress={() => {}}
            />
          ))}
        </VStack>

        <VStack>
          {chunkArray(icons, 3).map((row, rowIndex) => (
            <HStack key={rowIndex} className="bg-transparent" style={{ marginBottom: 16 }}>
              {row.map((icon) => (
                <VStack key={icon} className="flex-1 items-center" style={{ margin: 16 }}>
                  <Icon name={icon} size={48} color={getPrimaryColor('0')} />
                  <Spacer size={8} />
                  <Text className="w-full truncate text-center text-xs text-primary-0">{icon}</Text>
                </VStack>
              ))}
              {/* Fill empty columns if row has less than 3 icons */}
              {Array.from({ length: 3 - row.length }).map((_, idx) => (
                <View key={`empty-${idx}`} className="flex-1" />
              ))}
            </HStack>
          ))}
        </VStack>

        <TouchableOpacity
          style={{
            marginBottom: 16,
            paddingHorizontal: 16,
          }}
          onPress={toggleCheckbox}>
          <HStack align="center">
            <Checkbox
              value={isChecked}
              onValueChange={toggleCheckbox}
              color={isChecked ? getShadeColor('300') : undefined}
            />
            <Spacer size={8} />
            <Text
              id="terms-checkbox"
              size={14}
              regular
              style={{
                flex: 1,
              }}
              className="text-primary-0">
              Toggle experimental features
            </Text>
          </HStack>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
}
