import { shades } from 'helper/colors';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import Icon from 'assets/icons';

// Enum for card types
const CardType = {
  VISA: 'VISA',
  MASTERCARD: 'MASTERCARD',
  AMEX: 'AMEX',
  DISCOVER: 'DISCOVER',
  SOVRAN: 'SOVRAN',
};

export const CreditCardComponent = ({
  cardholderName = 'KELBIE',
  cvv = '123',
  cardType = CardType.SOVRAN,
  colorScheme = {
    primary: shades[300],
    secondary: shades[300],
    accent: '#FFCC70',
    text: '#FFFFFF',
  },
  showContactless = true,
  fontStyle = 'modern',
}) => {
  const flipAnimation = useState(new Animated.Value(0))[0];

  const handleFlip = () => {};

  // Interpolate flip animation
  const frontAnimatedStyle = {
    transform: [
      {
        rotateY: flipAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '180deg'],
        }),
      },
    ],
  };

  const backAnimatedStyle = {
    transform: [
      {
        rotateY: flipAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: ['180deg', '360deg'],
        }),
      },
    ],
  };

  // Component for contactless
  const CreditCardContactless = () => (
    <View style={styles.contactless}>
      <Icon name="feather:wifi" size={20} color={colorScheme.text} />
    </View>
  );

  // Component for logo
  const CreditCardLogo = () => (
    <View style={styles.logo}>
      {cardType === CardType.SOVRAN ? (
        <Text style={[styles.logoText, { color: colorScheme.text }]}>SOVRAN</Text>
      ) : (
        <Icon name="feather:credit-card" size={24} color={colorScheme.text} />
      )}
    </View>
  );

  // Get font family based on style
  const getFontFamily = () => {
    switch (fontStyle) {
      case 'modern':
        return 'System';
      case 'classic':
        return 'Georgia';
      case 'monospace':
        return 'Courier';
      default:
        return 'System';
    }
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handleFlip} activeOpacity={0.9}>
      {/* Front Side */}
      <Animated.View
        style={[
          styles.card,
          styles.cardFront,
          { backgroundColor: colorScheme.primary },
          frontAnimatedStyle,
        ]}>
        <View style={styles.cardHeader}>
          <View style={styles.rightHeader}>
            {showContactless && <CreditCardContactless />}
            <CreditCardLogo />
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.cardholderContainer}>
            <Text style={[styles.label, { color: colorScheme.text, fontFamily: getFontFamily() }]}>
              CARD NAME
            </Text>
            <Text
              style={[
                styles.cardholderName,
                { color: colorScheme.text, fontFamily: getFontFamily() },
              ]}>
              {cardholderName}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Back Side */}
      <Animated.View
        style={[
          styles.card,
          styles.cardBack,
          { backgroundColor: colorScheme.primary },
          backAnimatedStyle,
        ]}>
        <View style={styles.magneticStrip} />

        <View style={styles.cvvContainer}>
          <Text style={[styles.cvvLabel, { fontFamily: getFontFamily() }]}>CVV</Text>
          <View style={styles.cvvBox}>
            <Text style={[styles.cvvText, { fontFamily: getFontFamily() }]}>{cvv}</Text>
          </View>
        </View>

        <View style={styles.backLogoContainer}>
          <CreditCardLogo />
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

const { width } = Dimensions.get('window');
export const CARD_WIDTH = width - 23;
export const CARD_HEIGHT = CARD_WIDTH * 0.6; // Maintain credit card aspect ratio

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginVertical: 20,
  },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    position: 'absolute',
    backfaceVisibility: 'hidden',
    padding: 20,
  },
  cardFront: {
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  cardBack: {
    justifyContent: 'space-between',
    transform: [{ rotateY: '180deg' }],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactless: {
    marginRight: 10,
    transform: [{ rotate: '90deg' }],
  },
  logo: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontWeight: 'bold',
    fontSize: 18,
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardholderContainer: {
    flex: 2,
  },
  label: {
    fontSize: 10,
    opacity: 0.8,
    marginBottom: 5,
  },
  cardholderName: {
    fontSize: 16,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  magneticStrip: {
    width: '100%',
    height: 50,
    backgroundColor: '#000',
    marginTop: 20,
  },
  cvvContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    marginVertical: 15,
  },
  cvvLabel: {
    fontSize: 14,
    marginRight: 10,
    color: '#333',
  },
  cvvBox: {
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  cvvText: {
    fontSize: 14,
    color: '#333',
  },
  backLogoContainer: {
    alignItems: 'flex-end',
    marginBottom: 10,
    marginRight: 10,
  },
});
