import { StyleSheet, View, TouchableOpacity, Dimensions, ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Container from 'components/layout/Container';
import React, { useEffect, useState } from 'react';
import { Text } from 'components/common/Themed';
import { greys, shades } from 'helper/colors';
import { useTypedRoute } from 'helper/navigation';
import Icon from 'assets/icons';
import { useNavigation } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import CachedImage from 'components/common/Image';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { Button } from 'components/common/Button';
import { products } from './products';
import { Card } from 'components/common/Card';
import lookup from 'country-code-lookup';
import RenderHtml from 'react-native-render-html';
import { SheetManager } from 'react-native-actions-sheet';

const width = Dimensions.get('window').width;

const createStyles = (theme) =>
  StyleSheet.create({
    productImage: {
      width: '100%',
      height: 200,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    productAmount: {
      padding: 24,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      alignItems: 'center',
      margin: 2,
    },
    productDetails: {
      marginTop: 8,
      padding: 16,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
  });

const AmountList = ({ packages, currency, styles, filterCondition, selectedAmount, onSelect }) => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      style={{
        flex: 1,
        marginRight: filterCondition ? 4 : 0,
        marginLeft: filterCondition ? 0 : 4,
      }}>
      {packages
        .filter((_, index) => (filterCondition ? index % 2 === 0 : index % 2 !== 0))
        .map((pkg, index) => {
          const isSelected = pkg.value === selectedAmount;

          return (
            <TouchableOpacity key={index} onPress={() => onSelect(pkg.value)}>
              <View
                style={{
                  borderRadius: 8,
                  marginTop: 8,
                  backgroundColor: isSelected ? 'transparent' : greys(theme)[1500],
                }}>
                {isSelected ? (
                  <LinearGradient
                    colors={[shades[100], shades[200], shades[300], shades[400], shades[500]]}
                    style={{ borderRadius: 8 }}>
                    <AmountItem value={pkg.value} currency={currency} styles={styles} />
                  </LinearGradient>
                ) : (
                  <AmountItem value={pkg.value} currency={currency} styles={styles} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
    </View>
  );
};

const AmountItem = ({ value, currency, styles }) => (
  <View style={styles.productAmount}>
    <Text size={16} weight="bold">
      {value} {currency}
    </Text>
  </View>
);

const SectionTitle = ({ title }) => (
  <Text weight="regular" size={18} style={{ marginTop: 16 }}>
    {title}
  </Text>
);

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();
  const { slug, image } = useTypedRoute();
  const { showActionSheetWithOptions } = useActionSheet();

  const [selectedAmount, setSelectedAmount] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);

  const product = products.find((p) => p?.brand?.slug === slug);

  // Get available countries for this product
  const countries =
    products
      ?.filter(
        (p) =>
          product?.brand?.products &&
          Object.keys(product.brand.products).includes(p?.countryCode) &&
          p?.brand?.slug === slug &&
          p?.packages
      )
      .map((p) => p?.countryCode) || [];

  const selectedProduct = products.find(
    (p) => p.countryCode === selectedCountry && p.brand.slug === slug
  );

  const handleCountrySelect = () => {
    const options = countries.map((c) => lookup.byIso(c).country) || [];
    options.push('Cancel');
    const cancelButtonIndex = options.length - 1;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelButtonIndex) {
          const selectedCountryName = options[buttonIndex];
          const iso2 = lookup.byCountry(selectedCountryName)?.iso2;
          if (iso2) {
            setSelectedCountry(iso2);
            const selectedProduct = products.find(
              (p) => p.countryCode === iso2 && p.brand.slug === slug
            );
            setSelectedAmount(selectedProduct?.packages[0]?.value || null);
          }
        }
      }
    );
  };

  useEffect(() => {
    navigation.setOptions({
      title: product?.brand?.name,
    });
  }, [product]);

  return (
    <Container>
      <ScrollView>
        <CachedImage
          source={image || { uri: selectedProduct?.logoPreview }}
          style={styles.productImage}
        />

        <SectionTitle title="Country" />
        <TouchableOpacity onPress={handleCountrySelect}>
          <View style={styles.productDetails}>
            <Text size={16} weight="bold">
              {selectedCountry ? lookup.byIso(selectedCountry)?.country : 'Select Country'}
            </Text>
            <Icon name="fluent:chevron-down-12-filled" size={16} color={greys(theme)[0]} />
          </View>
        </TouchableOpacity>

        {selectedCountry && (
          <>
            <SectionTitle title="Amount" />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                width: '100%',
                backgroundColor: 'transparent',
              }}>
              <AmountList
                packages={selectedProduct?.packages || []}
                currency={selectedProduct?.currency || ''}
                styles={styles}
                filterCondition={true}
                selectedAmount={selectedAmount}
                onSelect={setSelectedAmount}
              />
              <AmountList
                packages={selectedProduct?.packages || []}
                currency={selectedProduct?.currency || ''}
                styles={styles}
                filterCondition={false}
                selectedAmount={selectedAmount}
                onSelect={setSelectedAmount}
              />
            </View>

            <SectionTitle title="Details" />
            <View style={styles.productDetails}>
              <RenderHtml
                tagsStyles={{
                  div: {
                    width: width - 48 - 16,
                    color: greys(theme)[200],
                  },
                  p: {
                    margin: 0,
                    marginBottom: 8,
                  },
                  a: {
                    color: shades[300],
                    textDecorationLine: 'none',
                  },
                  ul: {
                    margin: 0,
                    paddingLeft: 10,
                  },
                }}
                source={{ html: '<div>' + selectedProduct?.descriptions?.en + '</div>' }}
              />
            </View>

            <SectionTitle title="How to Redeem" />
            <View style={styles.productDetails}>
              <RenderHtml
                tagsStyles={{
                  div: {
                    width: width - 48 - 16,
                    color: greys(theme)[200],
                  },
                  p: {
                    margin: 0,
                  },
                  a: {
                    color: shades[300],
                    textDecorationLine: 'none',
                  },
                  ul: {
                    margin: 0,
                    paddingLeft: 10,
                  },
                }}
                source={{
                  html: '<div>' + selectedProduct?.instructions?.en + '</div>',
                }}
              />
            </View>

            {selectedProduct?.specialNote?.en && (
              <Card message={selectedProduct?.specialNote?.en} variant="warning" theme={theme} />
            )}

            <Card
              message="Gift cards are provided through a third party."
              variant="info"
              theme={theme}
            />

            <Button
              onPress={() =>
                SheetManager.show('email-sheet', {
                  onClose: (response: { action: string; message: string }) => {
                    if (response?.action === 'confirm' && response?.message) {
                      navigation.navigate('bitrefill', {
                        product: selectedProduct,
                        country: selectedCountry,
                        amount: selectedAmount,
                      });
                    }
                  },
                })
              }
              text="Buy"
            />
          </>
        )}
      </ScrollView>
    </Container>
  );
}
