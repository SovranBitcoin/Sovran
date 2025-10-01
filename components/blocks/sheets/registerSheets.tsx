import { default as registerPopup } from 'components/blocks/sheets/popup';
import { default as registerMintAccepter } from 'components/blocks/sheets/mintAccepter';
import { default as registerButtonHandler } from 'components/blocks/sheets/buttonHandler';
import { default as registerDelete } from 'components/blocks/sheets/delete';
import { default as registerTransactionMessage } from 'components/blocks/sheets/transaction-message';
import { default as registerEmojiPicker } from 'components/blocks/sheets/emoji-picker';
import { default as registerMintBalance } from 'components/blocks/sheets/mint-balance';

export function registerAllSheets({ context }: { context?: 'global' }) {
  registerPopup({ context });
  registerMintAccepter({ context });
  registerButtonHandler({ context });
  registerDelete({ context });
  registerTransactionMessage({ context });
  registerEmojiPicker({ context });
  registerMintBalance({ context });
}
