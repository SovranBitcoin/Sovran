import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import lookup from 'country-code-lookup';

import { greys } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { FlagIcon } from 'assets/icons';
import TextInput from 'components/common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { withSheetProvider } from 'hocs/withSheetProvider';

export const getCountry = (iso) => {
  try {
    return lookup.byIso(iso)?.country;
  } catch {
    return undefined;
  }
};

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const { countries, packageList, type } = useTypedRoute<'esimCountrySelection'>();
  const [searchText, setSearchText] = useState('');

  const filteredCountries = countries
    ?.map((c) => (type === 'vpn' ? c.isoCode : c))
    .filter((c) => {
      try {
        const countryName = lookup.byIso(c)?.country || '';
        return countryName.toLowerCase().includes(searchText.toLowerCase());
      } catch {
        return false;
      }
    })
    .filter((c) => getCountry(c))
    .map((c) => ({ iso: c, name: getCountry(c) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.iso);

  const handleCountrySelection = (country) => {
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
          type,
        },
        navigationOptions
      );
    }
  };

  return (
    <Modal title="Countries/regions" showBack buttons={<></>}>
      <View style={styles.container}>
        <TextInput
          placeholder="Search for country or region"
          value={searchText}
          onChangeText={setSearchText}
          style={styles.searchInput}
        />
        {filteredCountries.map((countryCode) => (
          <Pressable
            key={countryCode}
            style={styles.pressable}
            onPress={() => handleCountrySelection(countryCode)}>
            <FlagIcon width={32} height={32} country={countryCode} />
            <Text weight="heavy" size={16} style={styles.countryName}>
              {getCountry(countryCode)}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
      padding: 16,
    },
    searchInput: {
      marginBottom: 16,
    },
    pressable: {
      padding: 8,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      backgroundColor: greys(theme)[800],
      borderRadius: 16,
      borderColor: greys(theme)[600],
      borderWidth: 0.2,
    },
    countryName: {
      marginLeft: 8,
    },
  });

export default withSheetProvider(ModalScreen);
