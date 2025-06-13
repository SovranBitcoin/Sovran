import React from 'react';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Card } from 'components/common/Card';
import Container from 'components/layout/Container';
import { Section as TableSection } from 'components/common/Section';
import { RowButton, Section } from '../settings';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Text, View } from 'components/common/Themed';
import { Tabs } from 'components/common/Tabs';
import CreditCardComponent from 'components/common/NFCCard';
import Icon, { icons } from 'assets/icons';
import { greys, shades } from 'helper/colors';
import Checkbox from 'expo-checkbox';
import { useDispatch } from 'react-redux';
import { setExperimental } from 'helper/redux/settings';
import { RootState } from 'helper/redux/store/reducer';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { ScrollView } from 'react-native';

function chunkArray(array: any[], size: number) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const settings = useSelector((state: RootState) => state.settings.settings);
  const [isChecked, setIsChecked] = React.useState(settings?.experimental);

  const dispatch = useDispatch();
  const toggleCheckbox = () => {
    const newValue = !isChecked;
    setIsChecked(newValue);
    dispatch(setExperimental(newValue));
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
        <View style={{ margin: 8 }}></View>

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

        <View style={{ margin: 8 }}></View>
        <Text mono overpass size={16}>
          OverpassMono
        </Text>

        <View style={{ margin: 8 }}></View>

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

        {/* Examples for different tab counts */}
        <View className="mt-4 space-y-4">
          {[1, 2, 3, 4, 5].map((count) => (
            <Tabs
              key={`example-tabs-${count}`}
              amounts={Array(count).fill(0)}
              tabs={Array.from({ length: count }, (_, i) => `Tab ${i + 1}`)}
              selectedTab={'Tab 1'}
              handleTabPress={() => {}}
            />
          ))}
        </View>

        <View>
          {chunkArray(icons, 3).map((row, rowIndex) => (
            <View key={rowIndex} className="mb-4 flex-row">
              {row.map((icon) => (
                <View key={icon} className="m-4 flex-1 items-center">
                  <Icon name={icon} size={48} color={greys(theme)[0]} />
                  <Text
                    style={{ color: greys(theme)[0] }}
                    className="mt-2 w-full truncate text-center text-xs">
                    {icon}
                  </Text>
                </View>
              ))}
              {/* Fill empty columns if row has less than 3 icons */}
              {Array.from({ length: 3 - row.length }).map((_, idx) => (
                <View key={`empty-${idx}`} className="flex-1" />
              ))}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 16,
            paddingHorizontal: 16,
          }}
          onPress={toggleCheckbox}>
          <Checkbox
            value={isChecked}
            onValueChange={toggleCheckbox}
            color={isChecked ? shades[300] : undefined}
          />
          <Text
            id="terms-checkbox"
            style={{
              flex: 1,
              fontFamily: 'OverpassRegular',
              fontSize: 14,
              color: greys(theme)[0],
              marginLeft: 8,
            }}>
            Toggle experimental features
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
}
