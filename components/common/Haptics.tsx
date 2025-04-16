import * as ExpoHaptics from "expo-haptics";
import { Platform } from "react-native";

type HapticsType = {
  notificationAsync: (type: ExpoHaptics.NotificationFeedbackType) => Promise<void>,
  impactAsync: (style?: ExpoHaptics.ImpactFeedbackStyle) => Promise<void>,
  selectionAsync: () => Promise<void>,
  NotificationFeedbackType: {
    Success: ExpoHaptics.NotificationFeedbackType,
    Warning: ExpoHaptics.NotificationFeedbackType,
    Error: ExpoHaptics.NotificationFeedbackType,
  },
  ImpactFeedbackStyle: {
    Light: ExpoHaptics.ImpactFeedbackStyle,
    Medium: ExpoHaptics.ImpactFeedbackStyle,
    Heavy: ExpoHaptics.ImpactFeedbackStyle,
  }
}

const Haptics: HapticsType = Platform.OS === "web" ? {
  notificationAsync: (type = ExpoHaptics.NotificationFeedbackType.Success) => Promise.resolve(),
  impactAsync: (style = ExpoHaptics.ImpactFeedbackStyle.Medium) => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  NotificationFeedbackType: {
    Success: "Success",
    Warning: "Warning",
    Error: "Error",
  },
  ImpactFeedbackStyle: {
    Light: "Light",
    Medium: "Medium",
    Heavy: "Heavy",
  }
} : ExpoHaptics;

export default Haptics;