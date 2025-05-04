import { default as registerExample } from 'components/layout/sheets/example';
import { default as registerPopup } from 'components/layout/sheets/popup';
import { default as registerNpubcashSelector } from 'components/layout/sheets/npubcashSelector';
import { default as registerFilterProfiles } from 'components/layout/sheets/filterProfiles';
import { default as registerMintAccepter } from 'components/layout/sheets/mintAccepter';
import { default as registerNfc } from 'components/layout/sheets/nfc';
import { default as registerButtonHandler } from 'components/layout/sheets/buttonHandler';
import { default as registerDelete } from 'components/layout/sheets/delete';
import { default as registerMintAdder } from 'components/layout/sheets/mint-adder';
import { default as registerTransactionMessage } from 'components/layout/sheets/transaction-message';
import { default as registerCreditCard } from 'components/layout/sheets/creditCard';
import { default as registerEmojiPicker } from 'components/layout/sheets/emoji-picker';
import { default as registerEmail } from 'components/layout/sheets/email';

export function registerAllSheets({ context }: { context: 'global' | 'modal' }) {
  registerExample({ context });
  registerPopup({ context });
  registerNpubcashSelector({ context });
  registerFilterProfiles({ context });
  registerMintAccepter({ context });
  registerNfc({ context });
  registerButtonHandler({ context });
  registerDelete({ context });
  registerMintAdder({ context });
  registerTransactionMessage({ context });
  registerCreditCard({ context });
  registerEmojiPicker({ context });
  registerEmail({ context });
}
