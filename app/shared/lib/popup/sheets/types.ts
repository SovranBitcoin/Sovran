type CustomSheetFooterButton = {
  testID?: string;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'tertiary';
  isDisabled?: boolean;
};

export type CustomSheetFooterConfig = {
  buttons: CustomSheetFooterButton[];
};

export type CustomSheetSharedProps = {
  close: () => void;
  setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
};
