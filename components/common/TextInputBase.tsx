import React from "react";
import { StyleSheet } from "react-native";
import { useSelector } from "react-redux";
import { greys } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";

const TextInputBase = ({ Component, style, ...props }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  return <Component style={[styles.input, style]} {...props} />;
};

const createStyles = (theme) =>
  StyleSheet.create({
    input: {
      backgroundColor: greys(theme)[1800],
      borderWidth: 1,
      borderColor: greys(theme)[1300],
      shadowColor: greys(theme)[2300],
      shadowOffset: { width: 1, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      borderRadius: 32,
      padding: 10,
      color: greys(theme)[0],
      paddingLeft: 16,
      fontFamily: "OverpassBold",
      marginBottom: 0,
      borderStyle: "solid",
    },
  });

export default TextInputBase;
