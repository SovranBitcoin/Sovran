import { default as registerExample } from 'components/layout/sheets/example';
import { default as registerPopup } from 'components/layout/sheets/popup';
import { default as registerNpubcashSelector } from 'components/layout/sheets/npubcashSelector';
import { default as registerMintAccepter } from 'components/layout/sheets/mintAccepter';
import { default as registerReallocateAccepter } from 'components/layout/sheets/reallocateAccepter';
import { default as registerButtonHandler } from 'components/layout/sheets/buttonHandler';
import { default as registerDelete } from 'components/layout/sheets/delete';
import { default as registerMintAdder } from 'components/layout/sheets/mint-adder';
import { default as registerMintDelete } from 'components/layout/sheets/mint-delete';
import { default as registerTransactionMessage } from 'components/layout/sheets/transaction-message';
import { default as registerEmojiPicker } from 'components/layout/sheets/emoji-picker';
import { default as registerMintBalance } from 'components/layout/sheets/mint-balance';
import { default as registerEmail } from 'components/layout/sheets/email';
import { default as registerVideo } from 'components/layout/sheets/video';

export function registerAllSheets({ context }: { context?: 'global' }) {
  registerExample({ context });
  registerPopup({ context });
  registerNpubcashSelector({ context });
  registerMintAccepter({ context });
  registerReallocateAccepter({ context });
  registerButtonHandler({ context });
  registerDelete({ context });
  registerMintAdder({ context });
  registerMintDelete({ context });
  registerTransactionMessage({ context });
  registerEmojiPicker({ context });
  registerMintBalance({ context });
  registerEmail({ context });
  registerVideo({ context });
}
