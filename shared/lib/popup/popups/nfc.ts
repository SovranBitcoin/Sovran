import { makeParamPopup } from './factory';

export const nfcErrorPopup = makeParamPopup<{ title: string; message: string }>(
  ({ title, message }) => ({
    message: title,
    text: message,
    icon: 'icon:lucide:nfc',
    type: 'error',
  })
);
