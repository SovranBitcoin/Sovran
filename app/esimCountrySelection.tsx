import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { useSelector } from 'react-redux';
import lookup from 'country-code-lookup';

import Modal from 'components/layout/Modal';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { FlagIcon } from 'assets/icons';
import TextInput from 'components/common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { greys } from 'helper/colors';

export const getCountry = (iso: string) => {
  try {
    return lookup.byIso(iso)?.country;
  } catch {
    return undefined;
  }
};

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { countries, packageList, type, esimType, iccid } = useTypedRoute<'esimCountrySelection'>();
  const [searchText, setSearchText] = useState('');

  const filteredCountries = countries
    ?.map((c: any) => (type === 'vpn' ? c.isoCode : c))
    .filter((c: string) => {
      try {
        const countryName = lookup.byIso(c)?.country || '';
        return countryName.toLowerCase().includes(searchText.toLowerCase());
      } catch {
        return false;
      }
    })
    .filter((c: string) => getCountry(c) !== undefined)
    .map((c: string) => ({ iso: c, name: getCountry(c)! }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.iso);

  const handleCountrySelection = (country: string) => {
    const navigationOptions = { closeCurrentAndParent: true };

    if (type === 'vpn') {
      navigation.navigate(
        'vpns',
        { country, ...{ countries, packageList, type } },
        navigationOptions
      );
    } else {
      navigation.navigate(
        'esimsDataPlan',
        {
          country,
          countries,
          packageList,
          type: esimType,
          iccid,
        },
        navigationOptions
      );
    }
  };

  return (
    <Modal title="Countries/regions" showBack buttons={<></>}>
      <View className="bg-transparent p-4">
        <TextInput
          placeholder="Search for country or region"
          value={searchText}
          onChangeText={setSearchText}
          className="mb-4"
        />
        <Spacer size={12} />
        {filteredCountries.map((countryCode) => (
          <Pressable
            key={countryCode}
            className="mb-2 flex-row items-center rounded-2xl border border-opacity-20 p-2"
            style={{
              borderWidth: 0.2,
              backgroundColor: greys(theme)[800],
              borderRadius: 16,
              borderColor: greys(theme)[600],
            }}
            onPress={() => handleCountrySelection(countryCode)}>
            <FlagIcon width={32} height={32} country={countryCode} />
            <Text weight="heavy" size={16} className="ml-2">
              {getCountry(countryCode)}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
