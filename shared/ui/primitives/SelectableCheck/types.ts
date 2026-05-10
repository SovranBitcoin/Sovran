export type SelectableCheckStyle = 'circle' | 'square';

export type SelectableCheckVariant = 'default' | 'primary' | 'success' | 'warning' | 'error';

export interface SelectableCheckProps {
  /** Whether the option is currently selected. */
  selected: boolean;
  /** Toggle handler. Optional: when omitted, the mark renders as pure visual
   *  and the parent (e.g. a row Pressable) owns the press. */
  onChange?: (selected: boolean) => void;
  disabled?: boolean;
  /** Square edge length in px. Defaults to 20. */
  size?: number;
  /** Color palette — only the `square` style honors this. The `circle`
   *  style always uses the brand `accent` color. */
  variant?: SelectableCheckVariant;
  /** Visual style. `circle` is the in-app accent default (split-bill,
   *  participant pickers); `square` is the native-feeling checkbox
   *  (onboarding terms, settings toggles). */
  style?: SelectableCheckStyle;
  /** VoiceOver/TalkBack label naming the option this mark toggles. */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the toggle outcome. */
  accessibilityHint?: string;
}
