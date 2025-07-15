import { greys, Theme } from 'helper/colors';
import { StyleSheet, Dimensions } from 'react-native';

const calculatePosition = (index: number) => {
  const basePosition = 0;
  const maxOffset = 1000;
  const decayFactor = 0.1;
  return (
    basePosition + maxOffset * Math.sign(index) * (1 - Math.exp(-Math.abs(index) * decayFactor))
  );
};

const calculateSize = (index: number) => {
  const baseSize = 1;
  const minSize = 0.1;
  const decayFactor = 0.2;
  const reductionFactor = Math.exp(-Math.abs(index) * decayFactor);
  return minSize + (baseSize - minSize) * reductionFactor;
};

const calculateOpacity = (index: number) => {
  const baseOpacity = 1;
  const minOpacity = 0.1;
  const decayFactor = 0.5;
  const reductionFactor = Math.exp(-Math.abs(index) * decayFactor);
  return minOpacity + (baseOpacity - minOpacity) * reductionFactor;
};

const height = Dimensions.get('window').height;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    addButtonContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#ED0C46',
      position: 'absolute',
      zIndex: 10,
    },
    message: {
      color: greys(theme)[300],
      fontSize: 10,
      fontWeight: '500',
      textAlign: 'left',
      marginBottom: 8,
    },
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000',
      padding: 16,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: '#000000',
      borderRadius: 12,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: 'white',
      textAlign: 'center',
      marginBottom: 16,
    },
    scrollView: {
      height: height,
      overflow: 'visible',
    },
    stepsContainer: {
      paddingVertical: 24,
      paddingHorizontal: 16,
    },
    stepWrapper: {
      height: height, // Full height of the screen
      justifyContent: 'center', // Center the content vertically
    },
    stepContainer: {
      alignItems: 'center',
      marginBottom: 60,
    },
    stepContent: {
      alignItems: 'center',
    },
    iconContainer: {
      position: 'relative',
      width: 100,
      height: 100,
      marginBottom: 8,
      overflow: 'hidden',
    },
    iconOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    profileIcon: {
      width: 100 - 8,
      height: 100 - 8,
      borderRadius: 100,
    },
    stepLabel: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
      marginBottom: 8,
      textAlign: 'center',
    },
    stepMessage: {
      fontSize: 12,
      fontWeight: '500',
      color: 'white',
      marginBottom: 8,
      textAlign: 'center',
    },
    connectingLine: {
      width: 2,
      height: 96,
      backgroundColor: '#444444',
      marginVertical: 16,
      // Set transform origin to top
      transformOrigin: [0.5, 0, 0],
    },
    mintGroupContainer: {
      width: '100%',
      height: 200,
      position: 'relative',
    },
    mintContainer: {
      position: 'absolute',
      width: '100%',
      alignItems: 'center',
    },
    mintIconContainer: {
      position: 'relative',
      width: 100 - 8,
      height: 100 - 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mintIcon: {
      width: 100 - 8,
      height: 100 - 8,
      borderRadius: 100,
    },
    walletIconContainer: {
      position: 'absolute',
      bottom: -4,
      right: -4,
      backgroundColor: '#000000',
      borderRadius: 1000,
      padding: 6,
      borderWidth: 2,
      borderColor: '#000000',
    },
    currencyCard: {
      backgroundColor: '#111111',
      borderRadius: 8,
      padding: 12,
      width: '100%',
      maxWidth: 300,
      marginTop: 8,
    },
    mintLabel: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
      textAlign: 'center',
    },
    mintUrl: {
      fontSize: 12,
      color: greys(theme)[200],
      fontWeight: '500',
      marginBottom: 8,
    },
    currencyStatus: {
      fontSize: 14,
      color: '#999999',
      fontWeight: '500',
    },
    currenciesContainer: {
      gap: 8,
    },
    currencyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    currencyName: {
      width: 50,
      fontSize: 14,
      fontFamily: 'monospace',
      color: 'white',
    },
    progressBarContainer: {
      flex: 1,
      height: 6,
      backgroundColor: '#444444',
      borderRadius: 3,
      marginHorizontal: 8,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: '#ED0C46',
      borderRadius: 3,
    },
    arrowContainer: {
      position: 'absolute',
      top: '50%',
      right: 0,
      transform: [{ translateY: -12 }],
    },
    resetButton: {
      backgroundColor: '#ED0C46',
      borderRadius: 8,
      padding: 12,
      marginTop: 16,
      alignItems: 'center',
    },
    resetButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '500',
    },
    remainingSteps: {
      position: 'absolute',
      bottom: 64,
      color: greys(theme)[200],
      fontSize: 16,
      fontWeight: '500',
      textAlign: 'center',
      left: 0,
      right: 0,
    },
  });

export { calculatePosition, calculateSize, calculateOpacity, createStyles };
