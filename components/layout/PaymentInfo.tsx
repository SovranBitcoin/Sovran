import React from "react";
import { useState } from "react";
import { Pressable } from "react-native";
import ViewShot from "react-native-view-shot";
import * as Clipboard from "expo-clipboard";
import { AnimatedQRCode } from "components/common/QRCode";
import { Text, View } from "components/common/Themed";
import { Section } from "app/transaction";
import { GradientSkeleton } from "../common/GradientSkeleton";
import { greys, shades } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";
import { useSelector } from "react-redux";
import { TouchableOpacity } from "components/common/TouchableOpacity";
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { showMessage } from "helper/popup/popups";

export function PaymentInfo({
  unit,
  data,
  link,
  popupMessage,
  setUri,
  animated = false,
  variant = "primary",
  showSection = true,
}) {
  const theme = useSelector(memoizedGetTheme);
  const underscoreWidth = useSharedValue(0);
  const underscorePosition = useSharedValue(0);

  const [activeTab, setActiveTab] = useState(0);
  const tabWidths = useState([])[0];
  const tabOffsets = useState([])[0];

  const hasTabs = Array.isArray(data) && data.length > 0;
  const TABS = hasTabs ? data.map((item) => item.name) : [];

  const [selectedValue, setSelectedValue] = useState(
    hasTabs ? data[0].value : typeof data === "string" ? data : ""
  );

  const animatedUnderscoreStyle = useAnimatedStyle(() => ({
    width: withTiming(underscoreWidth.value, {
      duration: 200,
      easing: Easing.out(Easing.ease),
    }),
    transform: [
      {
        translateX: withTiming(underscorePosition.value, {
          duration: 200,
          easing: Easing.out(Easing.ease),
        }),
      },
    ],
  }));

  const measureTab = (event, index) => {
    const { width, x } = event.nativeEvent.layout;
    tabWidths[index] = width;
    tabOffsets[index] = x;
    if (index === 0 && underscoreWidth.value === 0) {
      underscoreWidth.value = width;
      underscorePosition.value = x;
    }
  };

  const handleTabPress = (index) => {
    setActiveTab(index);
    underscoreWidth.value = tabWidths[index];
    underscorePosition.value = tabOffsets[index];
    setSelectedValue(data[index].value);
  };

  const handleCopyPress = async () => {
    const textToCopy = link || selectedValue;
    await Clipboard.setStringAsync(textToCopy);
    const message =
      typeof popupMessage === "string"
        ? popupMessage
        : popupMessage[activeTab]?.name;
    showMessage(message);
  };

  return (
    <>
      {TABS.length > 0 && (
        <View
          style={{
            marginHorizontal: 16,
            paddingHorizontal: 16,
            backgroundColor: "transparent",
          }}
        >
          <View
            style={{
              justifyContent: "center",
              backgroundColor: "transparent",
              marginBottom: 0,
              flex: 1,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                backgroundColor: "transparent",
                flex: 1,
              }}
            >
              {TABS.map((tab, index) => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => handleTabPress(index)}
                  style={{
                    backgroundColor: "transparent",
                    flex: 1,
                    alignItems: "center",
                    position: "relative",
                    paddingBottom: 8,
                  }}
                  onLayout={(event) => measureTab(event, index)}
                >
                  <Text
                    style={{
                      fontFamily: "OverpassBold",
                      fontSize: 14,
                      color:
                        index === activeTab
                          ? greys(theme)[0]
                          : greys(theme)[700],
                    }}
                  >
                    {tab}
                  </Text>
                  {index === 0 && (
                    <Animated.View
                      style={[
                        {
                          height: 2,
                          width: "100%",
                          backgroundColor: shades[300],
                          marginTop: 8,
                          position: "absolute",
                          bottom: 0,
                        },
                        animatedUnderscoreStyle,
                      ]}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {selectedValue ? (
        <Pressable
          style={{ backgroundColor: "transparent" }}
          onPress={handleCopyPress}
        >
          <ViewShot
            style={{ backgroundColor: "transparent" }}
            captureMode="mount"
            onCapture={setUri}
          >
            <AnimatedQRCode
              padding={32}
              unit={unit}
              address={selectedValue}
              animate={animated}
              variant={variant}
            />
          </ViewShot>
        </Pressable>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "transparent",
          }}
        >
          <GradientSkeleton
            startColor={greys(theme)[1800]}
            endColor={greys(theme)[2300]}
          />
        </View>
      )}

      {selectedValue && showSection && (
        <Section
          special={true}
          style={{
            marginLeft: 32 - 16,
            marginRight: 32 - 16,
            marginBottom: 8,
          }}
          items={[
            {
              title: "",
              value: link || selectedValue,
            },
          ]}
        />
      )}
    </>
  );
}
