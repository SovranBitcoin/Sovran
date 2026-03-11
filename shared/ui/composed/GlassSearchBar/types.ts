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
}
