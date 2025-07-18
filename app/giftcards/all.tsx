import React from 'react';
import { StyleSheet, View, TouchableOpacity, ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Text';
import { greys, Theme } from 'helper/colors';
import { useNavigation } from 'expo-router';
import CachedImage from 'components/common/Image';
import { products } from './products';
import { SheetManager } from 'react-native-actions-sheet';

import amazon from 'assets/images/giftcards/amazon.png';
import deliveroo from 'assets/images/giftcards/deliveroo.png';
import justeat from 'assets/images/giftcards/justeat.png';
import uber from 'assets/images/giftcards/uber.png';
import adidas from 'assets/images/giftcards/adidas.png';
import nike from 'assets/images/giftcards/nike.png';
import airbnb from 'assets/images/giftcards/airbnb.png';
import asos from 'assets/images/giftcards/asos.png';
import costa from 'assets/images/giftcards/costa.png';

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    productGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    productCard: {
      width: '48%',
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      alignItems: 'flex-start',
      marginBottom: 8,
      margin: 0,
      padding: 0,
    },
    productImage: {
      width: '100%',
      height: 100,
      backgroundColor: greys(theme)[700],
      borderRadius: 8,
    },
    productInfo: {
      paddingVertical: 8,
      paddingHorizontal: 8,
      paddingBottom: 16,
    },
    searchButton: {
      width: '100%',
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 8,
      margin: 0,
      padding: 16,
    },
  });

// Filter products that are available in at least one country
const filterAvailableProducts = (productList, allProducts) => {
  return productList.filter((p2) => {
    const product = allProducts.find((p) => p?.brand?.slug === p2?.slug);

    const countries =
      allProducts
        ?.filter(
          (p) =>
            product?.brand?.products &&
            Object.keys(product.brand.products).includes(p?.countryCode) &&
            p?.brand?.slug === p2?.slug
        )
        ?.filter((p) => p?.packages)
        .map((p) => p?.countryCode) || [];

    return countries.length > 0;
  });
};

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();

  const productsList = [
    {
      productImage: amazon,
      title: 'Amazon',
      image: 'https://www.bitrefill.com/af/en/gift-cards/amazon-united-arab-emirates/',
      slug: 'amazon',
    },
    {
      productImage: deliveroo,
      title: 'Deliveroo',
      image: 'https://www.bitrefill.com/af/en/gift-cards/amazon-united-arab-emirates/',
      slug: 'deliveroo',
    },
    {
      productImage: justeat,
      slug: 'just-eat',
      title: 'Just Eat',
      image: 'https://www.bitrefill.com/af/en/gift-cards/just-eat-united-arab-emirates/',
    },
    {
      productImage: uber,
      title: 'Uber',
      image: 'https://www.bitrefill.com/af/en/gift-cards/uber-united-arab-emirates/',
    },
    {
      productImage: adidas,
      title: 'Adidas',
      slug: 'adidas',
      image: 'https://www.bitrefill.com/af/en/gift-cards/adidas-united-arab-emirates/',
    },
    {
      productImage: nike,
      title: 'Nike',
      image: 'https://www.bitrefill.com/af/en/gift-cards/nike-united-arab-emirates/',
      slug: 'nike',
    },
    {
      productImage: airbnb,
      slug: 'airbnb',
      title: 'Airbnb',
      image: 'https://www.bitrefill.com/af/en/gift-cards/airbnb-united-arab-emirates/',
    },
    {
      productImage: asos,
      slug: 'asos',
      title: 'ASOS',
      image: 'https://www.bitrefill.com/af/en/gift-cards/asos-united-arab-emirates/',
    },
    {
      productImage: costa,
      slug: 'costa',
      title: 'Costa',
      image: 'https://www.bitrefill.com/af/en/gift-cards/costa-united-arab-emirates/',
    },
  ];

  const availableProducts = filterAvailableProducts(productsList, products);

  const handleProductPress = (product) => {
    navigation.navigate('giftcards/giftcard', {
      slug: product.slug,
      image: product.productImage,
    });
  };

  return (
    <Container>
      <ScrollView>
        <View style={styles.productGrid}>
          {availableProducts.map((product, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => handleProductPress(product)}
              style={styles.productCard}>
              {product.productImage && (
                <CachedImage source={product.productImage} style={styles.productImage} />
              )}
              <View style={styles.productInfo}>
                <Text size={16} weight="bold">
                  {product.title}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => {
              SheetManager.show('email-sheet', {
                onClose: (response: { action: string; message: string }) => {
                  if (response?.action === 'confirm' && response?.message) {
                    navigation.navigate('bitrefill', {
                      email: response.message,
                    });
                  }
                },
              });
            }}
            style={styles.searchButton}>
            <Text size={16} weight="bold">
              Search All Giftcards
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Container>
  );
}
