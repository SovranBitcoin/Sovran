import type { ActionSheetPayloads } from '../actionSheetTypes';

export type CustomSheetId = keyof ActionSheetPayloads;

export type CustomSheetPage<K extends CustomSheetId = CustomSheetId> = {
  sheetId: K;
  payload: ActionSheetPayloads[K];
};

export type CustomSheetNavDirection = 'forward' | 'back';

type CustomSheetFooterButton = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'tertiary';
  isDisabled?: boolean;
};

export type CustomSheetFooterConfig = {
  buttons: CustomSheetFooterButton[];
  layout?: 'column' | 'row';
};

export type CustomSheetSharedProps = {
  close: () => void;
  pushCustomPage: <K extends CustomSheetId>(sheetId: K, payload: ActionSheetPayloads[K]) => void;
  popCustomPage: () => void;
  canPop: boolean;
  setFooterConfig: (config: CustomSheetFooterConfig | null) => void;
};

export type SheetLayoutConfig =
  | { mode: 'snapPoints'; snapPoints: readonly string[] }
  | { mode: 'contentHeight' };
