import { useEffect, useState } from "react";
import { Dimensions, StyleSheet, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useNavigation } from "expo-router";
import { greys } from "helper/colors";
import { URDecoder } from "@gandlaf21/bc-ur";
import { memoizedGetSelectedMint } from "helper/redux/cashu";
import { Text } from "components/common/Themed";
import { useSelector } from "react-redux";
import { memoizedGetTheme } from "helper/redux/settings";
import { useTypedRoute } from "helper/navigation";
import React from "react";
import { barcodeHandler } from "helper/payment-handler/handlers";
import * as Clipboard from "expo-clipboard";
import Svg, { Path } from "react-native-svg";
import { LightOff } from "assets/icons";
import { LightOn } from "assets/icons";
import { showMessage } from "helper/popup/popups";
import opacity from "hex-color-opacity";
import { BlurView } from "expo-blur";

// Make the camera full screen; recalc dimensions accordingly
const screenWidth = Dimensions.get("window").width;
const screenHeight = Dimensions.get("window").height;
const scanBoxSize = screenWidth * 0.8;

interface IconProps {
  color: string;
}

// Icon components
const ClipboardIcon = ({ color }: IconProps) => (
  <Svg width="24" height="24" viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 16H5V5h2v2h10V5h2v14z"
    />
  </Svg>
);

const GalleryIcon = ({ color }: IconProps) => (
  <Svg width="24" height="24" viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"
    />
  </Svg>
);

const FlashlightIcon = ({ color, on }: IconProps & { on: boolean }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24">
    <Path
      fill={color}
      d={
        on
          ? "M6 2h12v3H6zm0 5v11h12V7zm6 8.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
          : "M6 2v3h12V2zm0 5v11h12V7zm6 8.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
      }
    />
  </Svg>
);

// New Close Icon component
const CloseIcon = ({ color }: IconProps) => (
  <Svg width="24" height="24" viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
    />
  </Svg>
);

interface CameraProps {}

function Camera({}: CameraProps) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [scanned, setScanned] = useState(false);
  const [pubkey, setPubkey] = useState(null);
  const [urDecoder, setUrDecoder] = useState(new URDecoder());
  const [progress, setProgress] = useState(0);
  const [flashlightOn, setFlashlightOn] = useState<Boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  const { unit, accountIndex } = useTypedRoute<"camera">();
  const [hasPermission, requestPermission] = useCameraPermissions();
  const selectedMint = useSelector(memoizedGetSelectedMint);

  // Reset state when the component comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setScanned(false);
      setLoading(false);
      setProgress(0);
      setUrDecoder(new URDecoder());
    });
    return unsubscribe;
  }, [navigation]);

  if (!hasPermission?.granted) {
    return <View style={styles.container} />;
  }

  const toggleFlashlight = () => {
    setFlashlightOn((prev) => !prev);
  };

  const handleClipboardPress = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      // Handle the clipboard text similar to QR code scanning
      const scanning = { data: text };
      setLoading(true);
      barcodeHandler({
        scanning,
        navigation,
        urDecoder,
        unit,
        selectedMint,
        setProgress,
        setLoading,
        setScanned,
      });
    }
  };

  const handleCameraReady = async () => {
    try {
      setTimeout(() => {
        setFlashlightOn(false);
      }, 1000);
    } catch (error) {}
  };

  const handleGalleryPress = async () => {
    // We'll implement this later when we add image picker functionality
    showMessage("feature_coming_soon", {}, { emoji: "📸" });
  };

  const handleClosePress = () => {
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <CameraView
        mute
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={flashlightOn}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onCameraReady={handleCameraReady}
        onBarcodeScanned={(scanning) => {
          if (!navigation.isFocused()) {
            return;
          }
          if (!scanned || scanning.data.startsWith("ur:")) {
            setLoading(true);
            barcodeHandler({
              scanning,
              navigation,
              urDecoder,
              unit,
              selectedMint,
              setProgress,
              setLoading,
              setScanned,
            });
          }
        }}
      />

      {/* Close button in top left */}
      <View style={styles.topLeftContainer}>
        <BlurredCircleButton onPress={handleClosePress}>
          <CloseIcon color={greys(theme)[0]} />
        </BlurredCircleButton>
      </View>

      {/* Scanning overlay with white corners and progress text in line with the bottom corners */}
      <View style={styles.scanBoxContainer}>
        <View style={styles.scanBoxTopLeft} />
        <View style={styles.scanBoxTopRight} />
        <View style={styles.scanBoxBottomLeft} />
        <View style={styles.scanBoxBottomRight} />
        <View style={styles.progressContainer}>
          {progress > 0 ? (
            <Text style={styles.progressText}>
              Progress: {Math.round(progress * 100)}%
            </Text>
          ) : loading ? (
            <Text style={styles.progressText}>Loading...</Text>
          ) : (
            <Text style={styles.progressText}>Scanning...</Text>
          )}
        </View>
      </View>

      {/* Bottom buttons container */}
      <View style={styles.bottomButtonsContainer}>
        <BlurredCircleButton onPress={handleClipboardPress}>
          <ClipboardIcon color={greys(theme)[0]} />
        </BlurredCircleButton>
        <BlurredCircleButton onPress={handleGalleryPress}>
          <GalleryIcon color={greys(theme)[0]} />
        </BlurredCircleButton>
        <BlurredCircleButton onPress={toggleFlashlight}>
          {!flashlightOn ? (
            <LightOn color={greys(theme)[0]} />
          ) : (
            <LightOff color={greys(theme)[0]} />
          )}
        </BlurredCircleButton>
      </View>
    </View>
  );
}

interface BlurredCircleButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: any;
  intensity?: number;
  tint?: "light" | "dark" | "default";
}

const BlurredCircleButton = ({
  onPress,
  children,
  style,
  intensity = 75,
  tint = "dark",
}: BlurredCircleButtonProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <BlurView
      intensity={intensity}
      tint={tint}
      style={[styles.blurContainer, style]}
    >
      <TouchableOpacity style={styles.button} onPress={onPress}>
        {children}
      </TouchableOpacity>
    </BlurView>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    blurContainer: {
      width: 56,
      height: 56,
      borderRadius: 28,
      overflow: "hidden",
    },
    container: {
      flex: 1,
      position: "relative",
      backgroundColor: "black",
    },
    topLeftContainer: {
      position: "absolute",
      top: 48,
      left: 24,
      zIndex: 10,
    },
    progressContainer: {
      position: "absolute",
      bottom: 0,
      alignSelf: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
      padding: 8,
      borderRadius: 8,
    },
    progressText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    loadingContainer: {
      position: "absolute",
      top: screenHeight / 2,
      backgroundColor: "rgba(0,0,0,0.5)",
      borderRadius: 10,
      padding: 20,
    },
    loadingText: {
      color: greys(theme)[0],
      fontSize: 18,
    },
    actionSheetContainer: {
      padding: 16,
      backgroundColor: greys(theme)[2300],
    },
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: "600",
      marginBottom: 12,
    },
    currencyScroll: {
      flexGrow: 0,
    },
    currencyButton: {
      flexDirection: "column",
      alignItems: "center",
      marginRight: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[1800],
      width: 80,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
    },
    currencyIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: greys(theme)[400],
      marginBottom: 8,
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
    },
    mintScroll: {
      maxHeight: 300,
    },
    mintItem: {
      flexDirection: "row",
      alignItems: "center",
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[1800],
      marginBottom: 8,
    },
    selectedMintItem: {
      backgroundColor: greys(theme)[1500],
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
    },
    placeholderIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: greys(theme)[400],
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    mintBalance: {
      color: greys(theme)[400],
      fontSize: 14,
    },
    checkIconContainer: {
      marginLeft: "auto",
      marginRight: 8,
    },
    button: {
      padding: 16,
      backgroundColor: opacity(greys(theme)[1800], 0.1),
      borderRadius: 8,
      // marginTop: 16,
      alignItems: "center",
    },
    buttonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    flashlightButton: {
      padding: 16,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      marginBottom: 12,
      alignItems: "center",
    },
    flashlightButtonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    bottomButtonsContainer: {
      position: "absolute",
      bottom: 96,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 32,
    },
    rightButtonsContainer: {
      flexDirection: "row",
      gap: 16,
    },
    circleButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: opacity(greys(theme)[1800], 0.75),
      justifyContent: "center",
      alignItems: "center",
      marginHorizontal: 8,
    },
    // Scanning box overlay styles
    scanBoxContainer: {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: scanBoxSize,
      height: scanBoxSize,
      transform: [
        { translateX: -scanBoxSize / 2 },
        { translateY: -scanBoxSize / 2 },
      ],
    },
    scanBoxTopLeft: {
      position: "absolute",
      top: 0,
      left: 0,
      width: 30,
      height: 30,
      borderTopWidth: 4,
      borderLeftWidth: 4,
      borderColor: greys(theme)[0],
      shadowColor: "black",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 1,
      elevation: 2,
    },
    scanBoxTopRight: {
      position: "absolute",
      top: 0,
      right: 0,
      width: 30,
      height: 30,
      borderTopWidth: 4,
      borderRightWidth: 4,
      borderColor: greys(theme)[0],
      shadowColor: "black",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 1,
      elevation: 2,
    },
    scanBoxBottomLeft: {
      position: "absolute",
      bottom: 0,
      left: 0,
      width: 30,
      height: 30,
      borderBottomWidth: 4,
      borderLeftWidth: 4,
      borderColor: greys(theme)[0],
      shadowColor: "black",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 1,
      elevation: 2,
    },
    scanBoxBottomRight: {
      position: "absolute",
      bottom: 0,
      right: 0,
      width: 30,
      height: 30,
      borderBottomWidth: 4,
      borderRightWidth: 4,
      borderColor: greys(theme)[0],
      shadowColor: "black",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 1,
      elevation: 2,
    },
  });

export default Camera;
