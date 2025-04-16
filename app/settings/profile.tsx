import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  Clipboard,
  ScrollView,
  Image,
  TextInput,
} from "react-native";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { memoizedGetTheme } from "helper/redux/settings";
import { greys } from "helper/colors";
import { useNostr } from "helper/redux/nostr";
import Container from "components/layout/Container";
import Icon from "assets/icons";
import { showMessage } from "helper/popup/popups";

const Profile = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [isNsecVisible, setIsNsecVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [displayName, setDisplayName] = useState(currentProfile?.name || "");
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setIsEditMode(!isEditMode)}
          style={styles.headerButton}
        >
          <Icon
            name={isEditMode ? "fluent:save-24-filled" : "mage:edit-pen-fill"}
            size={24}
            color={greys(theme)[0]}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, isEditMode, theme]);

  const handleCopy = (text, messageKey) => {
    if (text) {
      Clipboard.setString(text);
      showMessage(messageKey);
    }
  };

  const renderDetail = (label, value, editable = false) => (
    <View style={styles.detailContainer}>
      <Text style={styles.detailLabel}>{label}</Text>
      {editable && isEditMode ? (
        <TextInput
          style={styles.detailText}
          value={displayName}
          onChangeText={setDisplayName}
        />
      ) : (
        <Text style={styles.detailText}>{value || "N/A"}</Text>
      )}
    </View>
  );

  const renderCopyableDetail = (
    label,
    value,
    messageKey,
    showEyeIcon = false
  ) => (
    <View style={styles.detailContainer}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.sensitiveField}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.detailText}>
            {showEyeIcon && !isNsecVisible ? "••••••••" : value || "N/A"}
          </Text>
        </ScrollView>
        <View style={styles.iconContainer}>
          {showEyeIcon && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setIsNsecVisible(!isNsecVisible)}
            >
              <Icon
                name={isNsecVisible ? "majesticons:eye-off" : "majesticons:eye"}
                size={16}
                color={greys(theme)[700]}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => handleCopy(value, messageKey)}
          >
            <Icon name="lucide:copy" size={16} color={greys(theme)[700]} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <Container>
      <SafeAreaView style={styles.content}>
        <Text style={styles.sectionTitle}>Profile Details</Text>

        <View style={styles.profilePictureContainer}>
          <Image
            source={{
              uri: currentProfile?.picture || "https://via.placeholder.com/150",
            }}
            style={styles.profilePicture}
          />
        </View>

        {renderDetail("Username:", currentProfile?.nip05)}
        {isEditMode && <Text style={styles.editModeText}>Edit</Text>}
        {renderDetail("Display Name:", displayName, true)}
        {renderCopyableDetail("npub:", currentProfile?.npub, "npub_copied")}
        {renderCopyableDetail(
          "nsec:",
          currentProfile?.nsec,
          "nsec_copied",
          true
        )}
      </SafeAreaView>
    </Container>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
    },
    sectionTitle: {
      marginVertical: 6,
      marginLeft: 8,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: "500",
      color: greys(theme)[600],
      textTransform: "uppercase",
    },
    profilePictureContainer: {
      alignItems: "center",
      marginVertical: 12,
    },
    profilePicture: {
      width: 100,
      height: 100,
      borderRadius: 50,
    },
    detailContainer: {
      marginVertical: 8,
      padding: 8,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    detailLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: greys(theme)[700],
    },
    detailText: {
      fontSize: 16,
      color: greys(theme)[0],
    },
    editModeText: {
      fontSize: 12,
      color: greys(theme)[500],
      marginBottom: 4,
    },
    sensitiveField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    iconButton: {
      padding: 8,
      backgroundColor: greys(theme)[1500],
      borderRadius: 4,
      marginLeft: 4,
    },
    headerButton: {
      flexDirection: "row",
      alignItems: "center",
    },
  });

export default Profile;
