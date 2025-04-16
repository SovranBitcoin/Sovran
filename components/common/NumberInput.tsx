import { Animated, StyleSheet } from "react-native";

import { StyledText, View } from "components/common/Themed";

import { useEffect, useRef } from "react";
import { greens, greys, shades } from "helper/colors";
import { useSelector } from "react-redux";
import { memoizedGetTheme } from "helper/redux/settings";
import { LightningUnit } from "assets/icons";
import React from "react";

export function NumberInput({
  type = "send",
  currency = "£",
  value,
  onChange,
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Mapping currency to symbol
  const currencySymbols = {
    usd: "$",
    eur: "€",
    gbp: "£",
    sat: "lu",
  };

  const currencySymbol = currencySymbols[currency.toLowerCase()] || currency;

  const precision = currencySymbol === "sat" ? 0 : 2;

  useEffect(() => {
    const length = value.toString().length;
    const newScale = length > 3 ? 1 - (length - 3) * 0.075 : 1;

    // Animated.spring(scaleAnim, {
    //   toValue: newScale, // Set minimum scale to 0.5
    //   friction: 5,
    //   useNativeDriver: true,
    // }).start();
  }, [value]);

  const theme = useSelector(memoizedGetTheme);

  const calculateFontSize = (text) => {
    const maxFontSize = 64; // Set your maximum font size
    const minFontSize = 36; // Set a minimum font size for readability
    const maxTextLength = 3; // Set a threshold for when the font size starts shrinking
    const shrinkStartLength = maxTextLength;
    const shrinkEndLength = 9; // When font size should be the smallest

    // Calculate font size proportionally based on text length
    const textLength = String(text).length;

    // If text length is short, return maxFontSize
    if (textLength <= maxTextLength) {
      return maxFontSize;
    }

    // If text length exceeds shrinkEndLength, return minFontSize
    if (textLength >= shrinkEndLength) {
      return minFontSize;
    }

    // Calculate proportional reduction in font size based on text length
    const shrinkRange = shrinkEndLength - shrinkStartLength;
    const fontSize =
      maxFontSize -
      ((textLength - shrinkStartLength) * (maxFontSize - minFontSize)) /
        shrinkRange;

    // Ensure the font size is not less than the minimum
    return Math.max(minFontSize, fontSize);
  };

  const formatNumberWithSpaces = (number) => {
    // Convert the number to a string
    const numberString = String(number);

    // Use regular expression to insert a space every three digits from the end
    return numberString.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  return (
    <View
      style={{
        backgroundColor: "transparent",
      }}
    >
      <Animated.View
        style={{
          display: "flex",
          justifyContent: "center",
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          margin: 0,
          padding: 0,
          overflow: "visible",
          transform: [{ scale: scaleAnim }],
          marginLeft: currencySymbol.length === 1 ? -22 : 22,
        }}
      >
        {currencySymbol.length === 1 && (
          <StyledText
            style={{
              fontFamily: "OverpassRegular",
              color: value ? shades[100] : greys()[400],
              fontSize: 28,
              marginRight: 4,
              marginTop: 12,
              flexShrink: 0,
              overflow: "hidden",
              numberOfLines: 1,
            }}
            secondary={!value}
            primary={type === "send" && value}
            negative={type === "receive" && value}
          >
            {currencySymbol}
          </StyledText>
        )}
        <View
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
            height: 100,
            backgroundColor: "transparent",
          }}
        >
          <StyledText
            style={{
              fontFamily: "OverpassHeavy",
              fontSize: calculateFontSize(value),
              margin: 0,
              padding: 0,
              zIndex: 100,
              flexShrink: 0,
              overflow: "visible",
            }}
            secondary={!value}
            primary={type === "send" && value}
            negative={type === "receive" && value}
            children={value ? formatNumberWithSpaces(String(value)) : "0"}
          />
        </View>

        {currencySymbol === "lu" ? (
          <View
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "transparent",
            }}
          >
            {type === "send" && (
              <LightningUnit color={value ? shades[300] : greys(theme)[700]} />
            )}
            {type === "receive" && (
              <LightningUnit color={value ? greens[300] : greys(theme)[700]} />
            )}
          </View>
        ) : (
          currencySymbol.length >= 2 && (
            <StyledText
              secondary={!value}
              primary={type === "send" && value}
              negative={type === "receive" && value}
              style={{
                fontFamily: "OverpassRegular",
                fontSize: 28,
                marginRight: 4,
                marginTop: 12,
                flexShrink: 0,
                overflow: "hidden",
                numberOfLines: 1,
              }}
            >
              {currencySymbol}
            </StyledText>
          )
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  transactionsLabel: {
    fontFamily: "OverpassHeavy",
    fontSize: 16,
    color: "#6E6E6E",
    margin: 0,
    padding: 0,
  },
  minus: {
    fontFamily: "OverpassBold",
    fontSize: 32,
    color: "#9A4141",
    marginRight: 4,
  },
  plus: {
    fontFamily: "OverpassBold",
    fontSize: 32,
    color: "#499A41",
    marginRight: 4,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: greys()[2300],
  },
  fullHeightView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: greys()[2300],
    // padding: 16,
  },
  container: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: greys()[1000],
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
});
