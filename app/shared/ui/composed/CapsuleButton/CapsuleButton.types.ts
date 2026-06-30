import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

export interface CapsuleButtonProps {
  label: string;
  icon: string;
  systemIcon?: string;
  onPress: () => void;
  color?: string;
  /**
   * Selected/active treatment — a foreground-tinted fill instead of the neutral
   * pill. Used where the capsule doubles as a toggle (e.g. Follow/Following).
   * Honored by every tier (liquid glass tint, blur tint, flat fill). Defaults
   * to `false`, so the status pills are unaffected.
   */
  isActive?: boolean;
  /**
   * High-emphasis call-to-action treatment — a prominent inverted capsule with
   * `background` content, e.g. the unfollowed "Follow" state. Liquid glass
   * renders it as a heavily foreground-tinted "prominent" glass; blur/flat fall
   * back to a solid `foreground` fill. Takes precedence over `isActive`. When
   * set, content color inverts to `background` unless `color` is given.
   */
  filled?: boolean;
  height?: number;
  roundedSide?: 'all' | 'left' | 'right';
  /** Size to label content instead of stretching to the full parent width. */
  fitContent?: boolean;
  iconSize?: number;
  textSize?: number;
  labelNumberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Stable accessibility identifier for log-doctor / WDA targeting. */
  testID?: string;
}
