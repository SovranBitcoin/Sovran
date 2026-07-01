import type { KeyboardTypeOptions } from 'react-native';

export interface GlassSearchBarProps {
  width?: number;
  /**
   * Field height (default 44). The wallet/search headers pass
   * HEADER_LAYOUT.BUTTON_HEIGHT so the bar swaps in at exactly the mint
   * selector's footprint instead of a visibly shorter field.
   */
  height?: number;
  clearKey: number;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  /** When set, debounces onChangeText calls by this many ms via InteractionManager. */
  debounceMs?: number;
  /**
   * Text the input remounts with (its `defaultValue`). Applied whenever
   * `clearKey` changes, so bumping `clearKey` with a non-empty `seedText`
   * pre-fills the field — used to re-run a tapped recent-search chip.
   */
  seedText?: string;
}
