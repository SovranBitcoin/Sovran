import React, { useEffect, useState, useMemo } from 'react';
import { Pressable } from 'react-native';
import { greys, shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Button } from 'components/common/Button';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { FlagIcon } from 'assets/icons';
import lookup from 'country-code-lookup';
import { useEsims } from 'helper/redux/esim';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { fetchQuote } from 'helper/apiClient';
import type { ProductPackage, QuoteResponse } from 'helper/apiClient';
import * as Localization from 'expo-localization';

// Helper function to get filtered packages
const getFilteredPackages = (packages: ProductPackage[], country: string): ProductPackage[] => {
  return packages
    .filter((pkg) => pkg.location === country)
    .filter((pkg) => pkg.duration >= 7)
    .sort((a, b) => {
      if (a.volume !== b.volume) {
        return a.volume - b.volume;
      }
      return a.price - b.price;
    });
};

// Components
interface CountryHeaderProps {
  country: string;
  type: 'BASE' | 'TOPUP' | undefined;
  loading: boolean;
  onChangeCountry: () => void;
}

const CountryHeader: React.FC<CountryHeaderProps> = ({
  country,
  type,
  loading,
  onChangeCountry,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const countryData = lookup.byIso(country);

  return (
    <View
      className="m-2 mb-0 flex-row items-center rounded-xl border-opacity-20 p-2"
      style={{
        backgroundColor: greys(theme)[800],
        borderColor: greys(theme)[600],
        borderWidth: 0.2,
      }}>
      <FlagIcon width={32} height={32} country={country} />
      <Text
        size={20}
        weight="heavy"
        className="ml-2 mr-2 flex-1"
        overpass
        heavy
        numberOfLines={1}
        ellipsizeMode="tail">
        {countryData?.country || country}
      </Text>
      {type === 'BASE' && (
        <View className="flex-1">
          <Button
            text="Change"
            variant="primary"
            noPadding
            onPress={onChangeCountry}
            disabled={loading}
            style={{
              width: '100%',
              marginBottom: 0,
            }}
          />
        </View>
      )}
    </View>
  );
};

interface PackageItemProps {
  pkg: ProductPackage;
  isSelected: boolean;
  onSelect: (packageCode: string) => void;
}

const PackageItem: React.FC<PackageItemProps> = ({ pkg, isSelected, onSelect }) => {
  const theme = useSelector(memoizedGetTheme);
  const volumeInGB = pkg.volume / 1073741824;
  const priceInDollars = pkg.price / 10000;

  return (
    <Pressable
      onPress={() => onSelect(pkg.packageCode)}
      className="rounded-2xl p-2"
      style={{
        backgroundColor: isSelected ? greys(theme)[700] : greys(theme)[800],
      }}>
      <View
        className="flex-row items-center justify-between rounded-2xl"
        style={{ backgroundColor: 'transparent' }}>
        <View className="rounded-2xl" style={{ backgroundColor: 'transparent' }}>
          <View
            className="flex-row items-center rounded-2xl"
            style={{ backgroundColor: 'transparent' }}>
            <View
              className="border-0.5 h-4 w-4 rounded-2xl"
              style={{
                backgroundColor: isSelected ? shades[200] : greys(theme)[600],
                borderColor: isSelected ? shades[200] : greys(theme)[500],
              }}
            />
            <View style={{ backgroundColor: 'transparent' }}>
              <Text
                weight="bold"
                size={16}
                className="ml-2"
                style={{
                  fontSize: 16,
                  fontFamily: 'OverpassBold',
                }}>
                {`${volumeInGB} GB`}
              </Text>
              <Text className="ml-2">{`${pkg.duration} days`}</Text>
            </View>
          </View>
        </View>
        <Text className="ml-2">{`$${priceInDollars}`}</Text>
      </View>
    </Pressable>
  );
};

interface PackageListProps {
  packages: ProductPackage[];
  selectedPackage: string | null;
  onSelectPackage: (packageCode: string) => void;
}

const PackageList: React.FC<PackageListProps> = ({
  packages,
  selectedPackage,
  onSelectPackage,
}) => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      className="m-2 overflow-hidden rounded-2xl border-opacity-20 p-2"
      style={{
        backgroundColor: greys(theme)[800],
        borderColor: greys(theme)[600],
        borderWidth: 0.2,
      }}>
      {packages.map((pkg) => (
        <PackageItem
          key={pkg.packageCode}
          pkg={pkg}
          isSelected={selectedPackage === pkg.packageCode}
          onSelect={onSelectPackage}
        />
      ))}
    </View>
  );
};

// Main Component
function EsimsDataPlanRefactor(): React.ReactElement {
  const navigation = useTypedNavigation();
  const { setEsims } = useEsims();

  // Get route parameters
  const routeParams = useTypedRoute<'esimsDataPlan'>();
  const { country: countryParam, packageList = [], countries = [], iccid = '', type } = routeParams;

  // State
  const [country, setCountry] = useState<string>(countryParam || 'US');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Memoized filtered packages
  const filteredPackages = useMemo(
    () => getFilteredPackages(packageList, country),
    [packageList, country]
  );

  // Set country based on locale if not provided
  useEffect(() => {
    if (!countryParam && Localization.region) {
      setCountry(Localization.region);
    }
  }, [countryParam]);

  // Update country when route param changes
  useEffect(() => {
    if (countryParam) {
      setCountry(countryParam);
    }
  }, [countryParam]);

  // Select default package when filtered packages change
  useEffect(() => {
    if (filteredPackages.length > 0) {
      const defaultPackage = filteredPackages[0];
      if (
        !selectedPackage ||
        !filteredPackages.find((pkg) => pkg.packageCode === selectedPackage)
      ) {
        setSelectedPackage(defaultPackage.packageCode);
      }
    }
  }, [filteredPackages, selectedPackage]);

  const handleContinue = async (): Promise<void> => {
    setLoading(true);

    const currentPackage = packageList.find((p) => p.packageCode === selectedPackage);
    // Only require iccid for TOPUP type, not for BASE (new eSIM) type
    if (!currentPackage || !type || (type === 'TOPUP' && !iccid)) {
      setLoading(false);
      console.error('Missing required data');
      return;
    }

    try {
      console.log('Fetching quote for:', currentPackage.packageCode, iccid, type);
      const result = await fetchQuote({
        packageCode: currentPackage.packageCode,
        iccid,
        type,
      });

      if (result.isOk()) {
        const data = result.value as QuoteResponse;

        const esimData = {
          package: currentPackage,
          sats: data.sats,
          request: data.request,
          type,
          iccid,
        };

        setEsims(esimData);

        // Navigate to checkout with structured data
        navigation.navigate('esimCheckout', {
          quote: data,
          package: currentPackage,
          esimParams: {
            iccid,
            type,
            topup: false,
            topupAmount: 0,
          },
        });
      } else if (result.isErr()) {
        const error = result.error;
        console.error('Quote fetch failed:', error.message);
        // TODO: Show user-friendly error message
      }
    } catch (error) {
      console.error('Error in handleContinue:', error);
      // TODO: Show user-friendly error message
    }

    setLoading(false);
  };

  const handleChangeCountry = (): void => {
    navigation.navigate('esimCountrySelection', {
      countries,
      packageList,
      type: 'esim',
      esimType: type, // Preserve the original esim type
      iccid, // Preserve the iccid
    });
  };

  return (
    <Modal
      showClose
      title="Get data plan"
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Continue',
              variant: 'primary',
              onPress: async () => await handleContinue(),
              loading: loading,
              disabled: loading,
            },
          ]}
        />
      }>
      <CountryHeader
        country={country}
        type={type}
        loading={loading}
        onChangeCountry={handleChangeCountry}
      />

      <PackageList
        packages={filteredPackages}
        selectedPackage={selectedPackage}
        onSelectPackage={setSelectedPackage}
      />
    </Modal>
  );
}

export default withSheetProvider(EsimsDataPlanRefactor);
