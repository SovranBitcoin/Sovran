import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { greys, shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Button } from 'components/common/Button';
import { Text, View } from 'components/common/Themed';
import { FlagIcon } from 'assets/icons';
import { useNavigation } from 'expo-router';
import lookup from 'country-code-lookup';
import { useEsims } from 'helper/redux/esim';
import * as Localization from 'expo-localization';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { fetchQuote } from 'helper/api/sovran';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();
  const { setEsims } = useEsims();

  const {
    country: countryParam,
    packageList,
    countries: countriesParams,
    iccid,
    type,
  } = useTypedRoute();

  const [country, setCountry] = useState(countryParam || 'US');
  const [packages, setPackages] = useState([]);
  const [countries, setCountries] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [loading, setLoading] = useState(false);

  // Set country based on locale if not provided
  useEffect(() => {
    if (!countryParam && Localization.region) {
      setCountry(Localization.region);
    }
  }, []);

  // Update state from route params
  useEffect(() => {
    if (packageList) setPackages(packageList);
    if (countriesParams) setCountries(countriesParams);
    if (countryParam) setCountry(countryParam);
  }, [packageList, countriesParams, countryParam]);

  // Select default package when country or packages change
  useEffect(() => {
    if (packages.length > 0) {
      const filteredPackages = packages
        .filter((r) => r.location === country)
        .filter((p) => p.duration >= 7)
        .sort((a, b) => {
          // Sort by volume first, then by price
          if (a.volume !== b.volume) {
            return a.volume - b.volume;
          }
          return a.price - b.price;
        });

      if (filteredPackages.length > 0) {
        setSelectedPackage(filteredPackages[0].packageCode);
      }
    }
  }, [country, packages]);

  const handleContinue = () => {
    setLoading(true);
    const currentPackage = packages.find((p) => p.packageCode === selectedPackage);

    fetchQuote({ packageCode: currentPackage.packageCode, iccid, type })
      .then((data) => {
        const esim = {
          package: {
            packageCode: currentPackage.packageCode,
            slug: currentPackage.slug,
            name: currentPackage.name,
            price: currentPackage.price,
            currencyCode: currentPackage.currencyCode,
            volume: currentPackage.volume,
            smsStatus: currentPackage.smsStatus,
            dataType: currentPackage.dataType,
            unusedValidTime: currentPackage.unusedValidTime,
            duration: currentPackage.duration,
            durationUnit: currentPackage.durationUnit,
            location: currentPackage.location,
            description: currentPackage.description,
            activeType: currentPackage.activeType,
            favorite: currentPackage.favourite,
            retailPrice: currentPackage.retailPrice,
            speed: currentPackage.speed,
          },
          sats: data.sats,
          request: data.request,
          type: type,
          iccid: iccid,
        };

        setEsims(esim);

        navigation.navigate('esimCheckout', {
          sats: esim.sats,
          request: esim.request,
          type: esim.type,
          iccid: esim.iccid,
          ...esim.package,
        });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Render a single package item
  const renderPackageItem = (pkg) => (
    <Pressable
      key={pkg.packageCode}
      onPress={() => setSelectedPackage(pkg.packageCode)}
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
        <View style={{ backgroundColor: 'transparent', borderRadius: 16 }}>
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
                borderColor: selectedPackage === pkg.packageCode ? shades[100] : greys(theme)[1000],
                borderWidth: 0.5,
              }}
            />
            <View style={{ backgroundColor: 'transparent' }}>
              <Text
                weight="bold"
                size={16}
                style={{
                  marginLeft: 8,
                  fontSize: 16,
                  fontFamily: 'OverpassBold',
                }}>
                {`${pkg.volume / 1073741824} GB`}
              </Text>
              <Text style={{ marginLeft: 8 }}>{`${pkg.duration} days`}</Text>
            </View>
          </View>
        </View>
        <Text style={{ marginLeft: 8 }}>{`$${pkg.price / 10000}`}</Text>
      </View>
    </Pressable>
  );

  // Filter and sort packages
  const filteredPackages = packages
    .filter((r) => r.location === country)
    .filter((p) => p.duration >= 7)
    .sort((a, b) => {
      if (a.volume !== b.volume) {
        return a.volume - b.volume;
      }
      return a.price - b.price;
    });

  return (
    <Modal
      showClose
      title="Get data plan"
      children={
        <>
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
              size={20}
              weight="heavy"
              style={{
                marginLeft: 8,
                fontSize: 20,
                fontFamily: 'OverpassHeavy',
                flex: 1,
                marginRight: 8,
              }}
              numberOfLines={1}
              ellipsizeMode="tail">
              {lookup.byIso(country).country}
            </Text>
            {type === 'BASE' && (
              <View
                style={{
                  alignItems: 'flex-end',
                  backgroundColor: 'transparent',
                  flex: 1,
                }}>
                <Button
                  text="Change"
                  variant="primary"
                  position="center"
                  noPadding
                  onPress={() => {
                    navigation.navigate('esimCountrySelection', {
                      countries,
                      type,
                      packageList: packages,
                    });
                  }}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: 16,
                  }}
                />
              </View>
            )}
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
            {filteredPackages.map(renderPackageItem)}
          </View>
        </>
      }
      buttons={
        <ButtonHandler
          context="modal"
          buttons={[
            {
              text: 'Continue',
              variant: 'primary',
              onPress: handleContinue,
              loading: loading,
              disabled: loading,
            },
          ]}
        />
      }
    />
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[2300],
    },
  });

export default withSheetProvider(ModalScreen);
