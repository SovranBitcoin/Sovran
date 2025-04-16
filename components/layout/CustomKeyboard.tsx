import { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { greys } from "helper/colors"; // assuming you have a shades color scale
import { useSelector } from "react-redux";
import Icon from "assets/icons";
import Haptics from "components/common/Haptics";
import { memoizedGetTheme } from "helper/redux/settings";

const CustomKeyboard = ({ onKeyPress, unit, loading }) => {
  const [inputValue, setInputValue] = useState("");
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const handlePress = (value) => {
    setInputValue((prevInputValue) => {
      let newValue;
      if (value === "<") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        newValue = prevInputValue.slice(0, -1);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        newValue = prevInputValue + value;
      }

      // Check if there are multiple dots in the input
      if (newValue.startsWith(".")) {
        return prevInputValue;
      }
      if ((newValue.match(/\./g) || []).length > 1) {
        return prevInputValue;
      }

      // Split the input on the dot to handle decimal part
      const parts = newValue.split(".");

      // If there is a decimal part and it has more than 2 digits, truncate it to 2 decimal places
      if (parts[1] && parts[1].length > 2) {
        newValue = `${parts[0]}.${parts[1].slice(0, 2)}`;
      }

      onKeyPress(newValue); // Call onKeyPress with the updated value

      return newValue; // Update the input value with the newValue
    });
  };

  const renderButton = (value) => (
    <TouchableOpacity
      key={value}
      style={[
        styles.button,
        loading && {
          opacity: 0.5,
        },
      ]}
      disabled={loading}
      onPress={() => handlePress(value)}
    >
      {/* <LinearGradient
        colors={[greys(theme)[2300], greys(theme)[1800]]}
        start={[1, 0]}
        end={[1, 0]}
        style={styles.buttonGradient}
      > */}
      {value === "<" ? (
        <Icon name="lucide:delete" size={24} color={"white"} />
      ) : (
        <Text style={styles.buttonText}>{value}</Text>
      )}
      {/* </LinearGradient> */}
    </TouchableOpacity>
  );

  const buttons = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [unit === "sat" ? "" : ".", "0", "<"],
  ];

  return (
    <View
      style={[
        styles.keyboardContainer,
        loading && {
          opacity: 0.5,
        },
      ]}
    >
      {buttons.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map(renderButton)}
        </View>
      ))}
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    keyboardContainer: {
      // paddingVertical: 10,
      // paddingHorizontal: 20,
      backgroundColor: "transparent",
      justifyContent: "center",
      alignItems: "center",
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 1,
    },
    button: {
      width: "33%",
      borderRadius: 0,
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
      marginHorizontal: 1,
      backgroundColor: greys(theme)[2300],
    },
    buttonGradient: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      width: "100%",
      height: "100%",
      borderRadius: 0,
    },
    buttonText: {
      padding: 16,
      paddingHorizontal: 24,
      fontSize: 24,
      color: "white",
      fontWeight: "bold",
      fontFamily: "OverpassBold",
    },
  });

export default CustomKeyboard;
