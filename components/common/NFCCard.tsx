import { shades } from 'helper/colors';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { CreditCard as CreditCardIcon, Wifi, CreditCard as CardIcon } from 'react-native-feather';

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
  cardNumber = '4111 1111 1111 1111',
  expiryDate = '12/25',
  cvv = '123',
  cardType = CardType.SOVRAN,
  colorScheme = {
    primary: shades[300],
    secondary: shades[500],
    accent: '#FFCC70',
    text: '#FFFFFF',
  },
  pattern = 'gradient',
  showChip = true,
  showContactless = true,
  fontStyle = 'modern',
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipAnimation = useState(new Animated.Value(0))[0];

  // Format card number to display with spaces
  const formatCardNumber = (number) => {
    return number
      .replace(/\s/g, '')
      .replace(/(.{4})/g, '$1 ')
      .trim();
  };

  const handleFlip = () => {
    SheetManager.show('credit-card-sheet', {
      // Handle data returned when sheet is closed
      onClose(data) {
        console.log('Credit card sheet closed with data:', data);
        // Process returned data here
      },
    });

    // setIsFlipped(!isFlipped);
    // Animated.timing(flipAnimation, {
    //   toValue: isFlipped ? 0 : 1,
    //   duration: 500,
    //   useNativeDriver: true,
    // }).start();
  };

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

  // Get pattern style based on pattern type
  const getPatternStyle = () => {
    switch (pattern) {
      case 'gradient':
        return {
          backgroundColor: colorScheme.primary,
          backgroundImage: `linear-gradient(135deg, ${colorScheme.primary} 0%, ${colorScheme.secondary} 100%)`,
        };
      case 'dots':
        return {
          backgroundColor: colorScheme.primary,
        };
      case 'lines':
        return {
          backgroundColor: colorScheme.primary,
        };
      default:
        return {
          backgroundColor: colorScheme.primary,
        };
    }
  };

  // Component for chip
  const CreditCardChip = () => (
    <View style={[styles.chip, { backgroundColor: colorScheme.accent }]}>
      <View style={styles.chipLines}>
        <View style={styles.chipLine} />
        <View style={styles.chipLine} />
        <View style={styles.chipLine} />
      </View>
    </View>
  );

  // Component for contactless
  const CreditCardContactless = () => (
    <View style={styles.contactless}>
      <Wifi width={20} height={20} color={colorScheme.text} />
    </View>
  );

  // Component for logo
  const CreditCardLogo = () => (
    <View style={styles.logo}>
      {cardType === CardType.SOVRAN ? (
        <Text style={[styles.logoText, { color: colorScheme.text }]}>SOVRAN</Text>
      ) : (
        <CardIcon width={24} height={24} color={colorScheme.text} />
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
export const CARD_WIDTH = width - 40;
export const CARD_HEIGHT = CARD_WIDTH * 0.6; // Maintain credit card aspect ratio

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginVertical: 20,
    perspective: 1000,
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
  chip: {
    width: 45,
    height: 35,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  chipLines: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
  },
  chipLine: {
    height: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginVertical: 2,
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
  cardNumberContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  cardNumber: {
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardholderContainer: {
    flex: 2,
  },
  expiryContainer: {
    flex: 1,
    alignItems: 'flex-end',
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
  expiryDate: {
    fontSize: 16,
    fontWeight: '500',
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

export default CreditCardComponent;
