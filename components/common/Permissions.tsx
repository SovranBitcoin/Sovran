import { Button } from "components/common/Button";
import { Text, View } from "components/common/Themed";
import {
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Linking,
} from "react-native";
import { QRCodeIcon } from "assets/icons";
import { Modal as RModal } from "react-native";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { greys, shades } from "helper/colors";
import { useSelector } from "react-redux";
import { memoizedGetTheme } from "helper/redux/settings";

export const PermissionsButton = ({
  description,
  position = "center",
  variant = "secondary",
  icon = <QRCodeIcon />,
  text = "Scan QR",
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const [visible, setVisible] = useState(false);

  const handleSave = () => {
    Linking.openSettings();
  };

  return (
    <View style={{ backgroundColor: "transparent" }}>
      <Button
        position={position}
        variant={variant}
        icon={icon}
        text={text}
        onPress={() => setVisible(true)}
      />
      <RModal
        animationType="slide"
        transparent={true}
        visible={visible}
        onRequestClose={() => setVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centeredView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalView}>
              <View style={styles.inputContainer}>
                {description && (
                  <Text
                    style={{
                      textAlign: "center",
                      fontSize: 14,
                      fontFamily: "OverpassRegular",
                      color: greys(theme)[200],
                      marginBottom: 16,
                    }}
                  >
                    {description}
                  </Text>
                )}
              </View>
              <View style={styles.buttonContainer}>
                <View style={{ flex: 1, backgroundColor: "transparent" }}>
                  <Button
                    position="left"
                    variant="secondary"
                    text={"Cancel"}
                    onPress={() => setVisible(false)}
                  />
                </View>
                <View style={{ flex: 1, backgroundColor: "transparent" }}>
                  <Button
                    position="right"
                    variant="primary"
                    text={"Open Settings"}
                    onPress={handleSave}
                  />
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </RModal>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    btcAmount: {
      fontFamily: "OverpassHeavy",
      fontSize: 10,
      color: greys(theme)[200],
      textAlign: "right",
      alignSelf: "flex-end",
    },
    sender: {
      fontFamily: "OverpassBold",
      fontSize: 14,
      color: greys(theme)[0],
    },
    date: {
      fontFamily: "OverpassRegular",
      fontSize: 10,
      color: greys(theme)[200],
    },
    centeredView: {
      flex: 1,
      justifyContent: "flex-end",
      marginTop: 22,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
    },
    modalView: {
      backgroundColor: "black",
      borderRadius: 20,
      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
      backgroundColor: greys(theme)[1800],
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      padding: 16,
      paddingBottom: 32,
      paddingTop: 32,
    },
    inputContainer: {
      marginLeft: 16,
      marginRight: 16,
      backgroundColor: "transparent",
    },
    label: {
      fontSize: 14,
      fontFamily: "OverpassHeavy",
      color: greys(theme)[1000],
      marginLeft: 16,
      marginBottom: 8,
    },
    textInput: {
      backgroundColor: greys(theme)[1800],
      borderWidth: 1,
      borderColor: greys(theme)[1300],
      shadowColor: greys(theme)[2300],
      shadowOffset: { width: 1, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      borderRadius: 86,
      padding: 8,
      color: greys(theme)[0],
      marginBottom: 8,
      paddingLeft: 16,
      fontFamily: "OverpassBold",
    },
    buttonContainer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: 8,
      backgroundColor: "transparent",
    },
    header: {
      textAlign: "center",
      fontSize: 20,
      fontFamily: "OverpassHeavy",
      color: shades[300],
    },
    link: {
      backgroundColor: "transparent",
      width: "100%",
    },
    utxoContainer: {
      flexDirection: "row",
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    checkboxContainer: {
      backgroundColor: "transparent",
      borderRadius: 999999999,
      margin: 16,
    },
    checkbox: {
      backgroundColor: "transparent",
      padding: 0,
      margin: 0,
    },
    utxoDetails: {
      flexDirection: "column",
      flex: 1,
      padding: 8,
      backgroundColor: "transparent",
    },
    utxoHeader: {
      backgroundColor: "transparent",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    utxoFooter: {
      backgroundColor: "transparent",
      flexDirection: "row",
      justifyContent: "space-between",
    },
  });
