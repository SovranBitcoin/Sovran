import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { greys, shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Button } from 'components/common/Button';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { FlagIcon } from 'assets/icons';
import { useNavigation } from 'expo-router';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';
import { useVpn } from 'helper/redux/lnvpn';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useRoute } from '@react-navigation/native';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { fetchVpnInvoice } from 'helper/api/sovran';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  const { params } = useRoute();
  const [country, setCountry] = useState('RU');

  const [packages, setPackages] = useState([
    {
      packageCode: 1,
      duration: '1 hour',
      duration_code: 0.1,
      price: 0.1,
    },
    {
      packageCode: 2,
      duration: '1 day',
      duration_code: 0.5,
      price: 0.5,
    },
    {
      packageCode: 3,
      duration: '1 week',
      duration_code: 1.5,
      price: 1.5,
    },
    {
      packageCode: 4,
      duration: '1 month',
      duration_code: 4,
      price: 4,
    },
    {
      packageCode: 5,
      duration: '3 months',
      duration_code: 9,
      price: 9,
    },
  ]);
  // const [countries, setCountries] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(3);

  // useEffect(() => {
  //   if (params.country) {
  //     return;
  //   }
  //   const localeCountry = Localization.region; // Get the region code (e.g., 'US')
  //   if (localeCountry) {
  //     setCountry(localeCountry); // Set the detected country code
  //   }
  // }, []);

  useEffect(() => {
    if (params?.packageList) {
      setPackages(JSON.parse(params?.packageList));
    }
  }, [params?.packageList]);

  useEffect(() => {
    if (params?.country) {
      setCountry(params?.country);
    }
  }, [params?.country]);

  const navigation = useNavigation();

  const { setVpn } = useVpn();

  const handleContinue = async () => {
    const selectedPackageDuration = packages.find(
      (p) => p.packageCode === selectedPackage
    )?.duration;
    const selectedPackageDurationCode = packages.find(
      (p) => p.packageCode === selectedPackage
    )?.duration_code;
    try {
      const data = await fetchVpnInvoice({ duration: selectedPackageDurationCode });

      setVpn({
        location: country,
        duration: selectedPackageDuration,
        duration_code: selectedPackageDurationCode,
        cc: params?.countries.find((c) => c.isoCode === country)?.cc,
        created_at: new Date().toISOString(),
        ...data,
      });

      navigation.navigate('vpnCheckout', {
        location: country,
        duration: selectedPackageDuration,
        hash: data.payment_hash,
        request: data.payment_request,
        price: packages.find((p) => p.packageCode === selectedPackage)?.price,
      });
    } catch {}
  };

  return (
    <Modal
      showClose
      title={`Get vpn plan`}
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Continue',
              variant: 'primary',
              onPress: handleContinue,
              loading: false,
              disabled: false,
            },
          ]}
        />
      }>
      <View
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          margin: 8,
          padding: 8,
          marginBottom: 0,
          backgroundColor: greys(theme)[1800],
          borderRadius: 12,
          borderColor: greys(theme)[1300],
          borderWidth: 0.2,
        }}>
        <FlagIcon width={32} height={32} country={country} />
        <Text
          weight="heavy"
          size={20}
          style={{
            marginLeft: 8,
            flex: 1, // Allows the text to take up available space
            marginRight: 8, // Adds space between the text and the button
          }}
          numberOfLines={1} // Ensures the text will not wrap to the next line
          ellipsizeMode="tail" // Truncates the text with an ellipsis if it's too long
        >
          {lookup.byIso(country).country}
        </Text>
        <View
          style={{
            alignItems: 'flex-end', // Aligns the button to the right
            backgroundColor: 'transparent',
          }}>
          <Button
            text={'Change'}
            variant="primary"
            // position="left"
            noPadding
            onPress={() => {
              navigation.navigate('esimCountrySelection', {
                countries: params?.countries,
                type: 'vpn',
              });
            }}
            disabled={false}
            style={{
              width: '100%',
              padding: 16,
              // marginRight: -16, // idk why i need this
            }}
          />
        </View>
      </View>

      <View
        style={{
          padding: 8,
          margin: 8,
          backgroundColor: greys(theme)[1800],
          borderRadius: 16,
          borderColor: greys(theme)[1300],
          borderWidth: 0.2,
          overflow: 'hidden',
        }}>
        {packages.map((pkg) => (
          <Pressable
            key={pkg.packageCode} // Added key prop here
            onPress={() => {
              setSelectedPackage(pkg.packageCode);
            }}
            style={{
              backgroundColor:
                selectedPackage === pkg.packageCode ? greys(theme)[1500] : greys(theme)[1800],

              borderRadius: 16,
              padding: 8,
            }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'transparent',
                borderRadius: 16,
              }}>
              <View
                style={{
                  backgroundColor: 'transparent',
                  borderRadius: 16,
                }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'transparent',
                    borderRadius: 16,
                  }}>
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 16,
                      backgroundColor:
                        selectedPackage === pkg.packageCode ? shades[200] : greys(theme)[1400],
                      borderColor:
                        selectedPackage === pkg.packageCode ? shades[100] : greys(theme)[1000],
                      borderWidth: 0.5,
                    }}></View>
                  <View
                    style={{
                      backgroundColor: 'transparent',
                    }}>
                    <Text
                      weight="bold"
                      size={16}
                      style={{
                        marginLeft: 8,
                      }}>
                      {pkg.duration}
                    </Text>
                    <Text style={{ marginLeft: 8 }}>{pkg.duration}</Text>
                  </View>
                </View>
              </View>
              <Text style={{ marginLeft: 8 }}>{'$' + pkg.price}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
