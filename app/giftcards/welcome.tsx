import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Container from 'components/layout/Container';
import React from 'react';
import { Text } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { useNavigation } from 'expo-router';
import CachedImage from 'components/common/Image';
import { products } from './products';
import { SheetManager } from 'react-native-actions-sheet';

const createStyles = (theme) =>
  StyleSheet.create({
    productGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    productCard: {
      width: '48%',
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      alignItems: 'flex-start',
      marginBottom: 8,
      margin: 0,
      padding: 0,
    },
    productImage: {
      width: '100%',
      height: 100,
      backgroundColor: greys(theme)[1500],
      borderRadius: 8,
    },
    productInfo: {
      paddingVertical: 8,
      paddingHorizontal: 8,
      paddingBottom: 16,
    },
    searchButton: {
      width: '100%',
      backgroundColor: greys(theme)[1800],
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
      productImage: require('assets/images/giftcards/amazon.png'),
      title: 'Amazon',
      image: 'https://www.bitrefill.com/af/en/gift-cards/amazon-united-arab-emirates/',
      slug: 'amazon',
    },
    {
      productImage: require('assets/images/giftcards/deliveroo.png'),
      title: 'Deliveroo',
      image: 'https://www.bitrefill.com/af/en/gift-cards/amazon-united-arab-emirates/',
      slug: 'deliveroo',
    },
    {
      productImage: require('assets/images/giftcards/justeat.png'),
      slug: 'just-eat',
      title: 'Just Eat',
      image: 'https://www.bitrefill.com/af/en/gift-cards/just-eat-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/uber.png'),
      title: 'Uber',
      image: 'https://www.bitrefill.com/af/en/gift-cards/uber-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/adidas.png'),
      title: 'Adidas',
      slug: 'adidas',
      image: 'https://www.bitrefill.com/af/en/gift-cards/adidas-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/nike.png'),
      title: 'Nike',
      image: 'https://www.bitrefill.com/af/en/gift-cards/nike-united-arab-emirates/',
      slug: 'nike',
    },
    {
      productImage: require('assets/images/giftcards/airbnb.png'),
      slug: 'airbnb',
      title: 'Airbnb',
      image: 'https://www.bitrefill.com/af/en/gift-cards/airbnb-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/asos.png'),
      slug: 'asos',
      title: 'ASOS',
      image: 'https://www.bitrefill.com/af/en/gift-cards/asos-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/costa.png'),
      slug: 'costa',
      title: 'Costa',
      image: 'https://www.bitrefill.com/af/en/gift-cards/costa-united-arab-emirates/',
    },
    {
      productImage: require('assets/images/giftcards/costa.png'),
      slug: 'apple',
      title: 'Apple',
      image: 'https://www.bitrefill.com/af/en/gift-cards/costa-united-arab-emirates/',
    },
  ];

  const availableProducts = filterAvailableProducts(productsList, products);

  const handleProductPress = (product) => {
    navigation.navigate('giftcards/welcome2', {
      slug: product.slug,
      image: product.productImage,
    });
  };

  return (
    <Container>
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
    </Container>
  );
}
