import React from "react";
import { StyleSheet, View, TouchableOpacity } from "react-native";
import { StyledText, Text } from "components/common/Themed";
import Icon from "assets/icons";
import { greys } from "helper/colors";
import { useSelector } from "react-redux";
import { memoizedGetTheme } from "helper/redux/settings";
import BottomButtons from "./BottomButtons";
import { useTypedNavigation } from "helper/navigation";

/**
 * InfoSection - Reusable component for displaying title, highlight text, and description
 */
export const InfoSection = ({
  title,
  highlight,
  description,
  highlightColors,
  style,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={[styles.infoContainer, style]}>
      <Text size={36} style={styles.titleText}>
        {title}
      </Text>
      <StyledText
        style={styles.highlightText}
        custom
        colors={highlightColors}
        size={32}
      >
        {highlight}
      </StyledText>
      <Text size={16} style={styles.descriptionText}>
        {description}
      </Text>
    </View>
  );
};

/**
 * NavigationFooter - Component for navigating between onboarding screens
 */
export const NavigationFooter = ({
  onBack,
  onNext,
  backText = "Back",
  nextText = "Next",
  theme,
  style,
}) => {
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

/**
 * ActionFooter - Component for displaying action buttons
 */
export const ActionFooter = ({ actions, theme, style }) => {
  const styles = createStyles(theme);

  return (
    <View style={[styles.footerContainer, style]}>
      {actions.map((action, index) => {
        const isPrimary = action.variant === "primary";
        const buttonStyle = [
          styles.actionButton,
          isPrimary && styles.primaryButton,
          {
            backgroundColor: isPrimary ? greys(theme)[0] : "transparent",
          },
        ];

        return (
          <TouchableOpacity
            key={index}
            style={buttonStyle}
            onPress={action.onPress}
          >
            <Text
              size={16}
              style={{
                color: isPrimary ? greys(theme)[2300] : greys(theme)[0],
                fontFamily: "LexendMedium",
              }}
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

/**
 * HeaderSkipButton - Component for the skip button in the header
 */
export const HeaderSkipButton = ({ onPress, theme }) => (
  <TouchableOpacity
    style={{ flexDirection: "row", alignItems: "center" }}
    onPress={onPress}
  >
    <Text size={16} style={{ marginRight: 8 }}>
      Skip
    </Text>
    <Icon name="fa6-solid:chevron-right" size={20} color={greys(theme)[0]} />
  </TouchableOpacity>
);

/**
 * OnboardingLayout - A wrapper component that provides consistent onboarding screens
 */
export function OnboardingLayout({
  title,
  highlight,
  description,
  highlightColors,
  nextScreen,
  actions,
}) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  const handleNext = () => navigation.navigate(nextScreen || "/");
  const handleBack = () => navigation.goBack();

  return (
    <View style={styles.centeredContainer}>
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
        <NavigationFooter
          onBack={handleBack}
          onNext={handleNext}
          theme={theme}
        />
      )}
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    titleText: {
      fontFamily: "LexendBold",
      lineHeight: 36,
    },
    highlightText: {
      fontSize: 48,
      fontFamily: "LexendBlack",
      lineHeight: 48,
    },
    descriptionText: {
      fontFamily: "LexendRegular",
      textAlign: "left",
      marginVertical: 8,
    },
    buttonTextLeft: {
      marginLeft: 8,
    },
    buttonTextRight: {
      marginRight: 8,
    },
    infoContainer: {
      alignItems: "flex-start",
      alignSelf: "stretch",
    },
    centeredContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      height: "100%",
      backgroundColor: greys(theme)[2300],
    },
    centeredContent: {
      justifyContent: "center",
      alignItems: "flex-start",
      flex: 1,
      alignSelf: "stretch",
      margin: 16,
    },
    footerContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
      padding: 16,
      position: "absolute",
      bottom: 16,
    },
    footerButton: {
      flexDirection: "row",
      alignItems: "center",
    },
    actionButton: {
      padding: 16,
      borderRadius: 8,
      flex: 1,
      marginHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.1)",
    },
    primaryButton: {
      borderWidth: 0,
    },
  });
