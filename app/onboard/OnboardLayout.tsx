import React from 'react';
import { StyleSheet, View, TouchableOpacity, ViewStyle, StyleProp, ColorValue } from 'react-native';
import { StyledText, Text } from 'components/common/Text';
import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import BottomButtons, { ButtonProps } from './BottomButtons';
import { useTypedNavigation } from 'helper/navigation';
import { Cashews } from 'assets/images';
import { LinearGradient } from 'expo-linear-gradient';

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
    <View style={[styles.footerContainer, style]}>
      <TouchableOpacity style={styles.footerButton} onPress={onBack}>
        <Icon name="fa6-solid:chevron-left" size={20} color={iconColor} />
        <Text size={16} style={styles.buttonTextLeft}>
          {backText}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.footerButton} onPress={onNext}>
        <Text size={16} style={styles.buttonTextRight}>
          {nextText}
        </Text>
        <Icon name="fa6-solid:chevron-right" size={20} color={iconColor} />
      </TouchableOpacity>
    </View>
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
    <View style={styles.centeredContainer}>
      <View
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          backgroundColor: 'black',
        }}>
        <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} />
        <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} />
        <Cashews style={{ width: '100%', height: undefined, aspectRatio: 1, opacity: 0.66 }} />
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
      <View style={styles.centeredContent}>
        <InfoSection
          title={title}
          highlight={highlight}
          description={description}
          highlightColors={highlightColors}
        />
      </View>

      {actions ? (
        <BottomButtons buttons={actions} theme={theme} />
      ) : (
        <NavigationFooter onBack={handleBack} onNext={handleNext} theme={theme} />
      )}
    </View>
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
    buttonTextRight: {
      marginRight: 8,
    },
    infoContainer: {
      alignItems: 'flex-start',
      alignSelf: 'stretch',
    },
    centeredContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      backgroundColor: greys(theme)[950],
    },
    centeredContent: {
      justifyContent: 'center',
      alignItems: 'flex-start',
      flex: 1,
      alignSelf: 'stretch',
      margin: 16,
    },
    footerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      padding: 16,
      position: 'absolute',
      bottom: 16,
    },
    footerButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionButton: {
      padding: 16,
      borderRadius: 8,
      flex: 1,
      marginHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    primaryButton: {
      borderWidth: 0,
    },
  });
