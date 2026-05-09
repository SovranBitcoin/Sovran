export interface CapsuleButtonProps {
  label: string;
  icon: string;
  systemIcon?: string;
  onPress: () => void;
  color?: string;
  height?: number;
  roundedSide?: 'all' | 'left' | 'right';
  /** Stable accessibility identifier for log-doctor / WDA targeting. */
  testID?: string;
}
