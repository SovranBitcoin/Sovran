import type { KeyboardTypeOptions } from 'react-native';

export interface GlassSearchBarProps {
  width?: number;
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
