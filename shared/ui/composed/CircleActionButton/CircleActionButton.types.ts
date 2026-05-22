export interface CircleActionButtonProps {
  /** Monicon name used on Android and the pre-liquid-glass iOS fallback. */
  icon: string;
  /** SF Symbol name for the SwiftUI glass path (iOS 26+). If omitted on
   *  iOS, the `icon` monicon is rendered inside the blur fallback instead. */
  systemIcon?: string;
  /** Optional caption under the circle. Omit for icon-only (e.g. camera toolbar). */
  label?: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  /** Override for the icon tint. Defaults to `foreground`. */
  color?: string;
  testID?: string;
  /** VoiceOver/TalkBack label. Defaults to `label`; required for icon-only
   *  buttons (no `label`) since the glyph carries no name. */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the action's outcome. */
  accessibilityHint?: string;
}

export const CIRCLE_SIZE = 52;
export const ICON_SIZE = 22;
export const LABEL_TOP_MARGIN = 6;
export const LABEL_LINE_HEIGHT = 18;
export const LABELED_BUTTON_MIN_HEIGHT = CIRCLE_SIZE + LABEL_TOP_MARGIN + LABEL_LINE_HEIGHT;
