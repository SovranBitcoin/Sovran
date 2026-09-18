import type { LayoutChangeEvent } from 'react-native';

/** What `LiquidChatComposer` hands its SwiftUI glass tier. */
export interface LiquidChatComposerGlassProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Logged send handler; the tier only calls it when `canSend`. */
  onSend: () => void;
  /** Logged [+] handler. */
  onPlusPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  disabled?: boolean;
  plusDisabled?: boolean;
  placeholder: string;
  bottomPadding: number;
  hasText: boolean;
  canSend: boolean;
  foreground: string;
}

/** Accessible name of the leading [+] button, shared by both tiers. */
export function plusA11yLabel(plusDisabled: boolean | undefined): string {
  return plusDisabled ? 'Image attach not supported by this model' : 'Composer actions';
}
