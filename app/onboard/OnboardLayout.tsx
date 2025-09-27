import React from 'react';
import { StyleSheet, View, TouchableOpacity, ViewStyle, StyleProp, ColorValue } from 'react-native';
import { StyledText, Text } from 'components/common/Text';
import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import BottomButtons, { ButtonProps } from './BottomButtons';
import { useTypedNavigation } from 'helper/navigation';
import { LinearGradient } from 'expo-linear-gradient';
import { HStack, VStack } from 'components/common/View';

interface InfoSectionProps {
  title: string;
  highlight: string;
  description: string;
  highlightColors: readonly [ColorValue, ColorValue, ...ColorValue[]];
  style?: StyleProp<ViewStyle>;
}

export const InfoSection = ({
  title,
  highlight,
  description,
  highlightColors,
  style,
}: InfoSectionProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={[styles.infoContainer, style]}>
      <Text size={36} style={styles.titleText}>
        {title}
      </Text>
      <StyledText style={styles.highlightText} custom colors={highlightColors} size={32}>
        {highlight}
      </StyledText>
      <Text size={16} style={styles.descriptionText}>
        {description}
      </Text>
    </View>
  );
};

interface NavigationFooterProps {
  onBack: () => void;
  onNext: () => void;
  backText?: string;
  nextText?: string;
  theme: Theme;
  style?: StyleProp<ViewStyle>;
}

export const NavigationFooter = ({
  onBack,
  onNext,
  backText = 'Back',
  nextText = 'Next',
  theme,
  style,
}: NavigationFooterProps) => {
  const styles = createStyles(theme);
  const iconColor = greys(theme)[0];

  return (
    <HStack style={[styles.footerContainer, style]} justify="space-between">
      <TouchableOpacity style={styles.footerButton} onPress={onBack}>
        <HStack align="center">
          <Icon name="fa6-solid:chevron-left" size={20} color={iconColor} />
          <Text size={16} style={styles.buttonTextLeft}>
            {backText}
          </Text>
        </HStack>
      </TouchableOpacity>
      <TouchableOpacity style={styles.nextButton} onPress={onNext}>
        <HStack align="center">
          <Text size={18} weight="bold" style={styles.nextButtonText}>
            {nextText}
          </Text>
          <Icon name="fa6-solid:chevron-right" size={22} color={greys(theme)[950]} />
        </HStack>
      </TouchableOpacity>
    </HStack>
  );
};

interface OnboardingLayoutProps {
  title: string;
  highlight: string;
  description: string;
  highlightColors: readonly [ColorValue, ColorValue, ...ColorValue[]];
  nextScreen: string;
  actions?: ButtonProps[];
}

export function OnboardingLayout({
  title,
  highlight,
  description,
  highlightColors,
  nextScreen,
  actions,
}: OnboardingLayoutProps) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  const handleNext = () => navigation.navigate(nextScreen || '/');
  const handleBack = () => navigation.goBack();

  return (
    <VStack align="center" justify="center" style={styles.centeredContainer}>
      <View
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          backgroundColor: 'black',
        }}>
        <LinearGradient
          colors={['black', 'transparent', 'black']}
          locations={[0, 0.5, 1]}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          }}
        />
      </View>
      <VStack align="flex-start" justify="center" style={styles.centeredContent}>
        <InfoSection
          title={title}
          highlight={highlight}
          description={description}
          highlightColors={highlightColors}
        />

        {actions ? (
          <BottomButtons buttons={actions} theme={theme} />
        ) : (
          <NavigationFooter onBack={handleBack} onNext={handleNext} theme={theme} />
        )}
      </VStack>
    </VStack>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    titleText: {
      fontFamily: 'LexendBold',
      lineHeight: 36,
    },
    highlightText: {
      fontSize: 48,
      fontFamily: 'LexendBlack',
      lineHeight: 48,
    },
    descriptionText: {
      fontFamily: 'LexendRegular',
      textAlign: 'left',
      marginVertical: 8,
    },
    buttonTextLeft: {
      marginLeft: 8,
    },
    infoContainer: {
      alignItems: 'flex-start',
      alignSelf: 'stretch',
    },
    centeredContainer: {
      flex: 1,
      height: '100%',
      backgroundColor: greys(theme)[950],
    },
    centeredContent: {
      flex: 1,
      alignSelf: 'stretch',
      margin: 16,
    },
    footerContainer: {
      width: '100%',
      padding: 16,
      position: 'absolute',
      bottom: 16,
    },
    footerButton: {
      alignItems: 'center',
    },
    nextButton: {
      alignItems: 'center',
      backgroundColor: greys(theme)[0],
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 12,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    nextButtonText: {
      color: greys(theme)[950],
      marginRight: 8,
    },
  });
