import { default as registerExample } from 'components/blocks/sheets/example';
import { default as registerPopup } from 'components/blocks/sheets/popup';
import { default as registerNpubcashSelector } from 'components/blocks/sheets/npubcashSelector';
import { default as registerMintAccepter } from 'components/blocks/sheets/mintAccepter';
import { default as registerReallocateAccepter } from 'components/blocks/sheets/reallocateAccepter';
import { default as registerButtonHandler } from 'components/blocks/sheets/buttonHandler';
import { default as registerDelete } from 'components/blocks/sheets/delete';
import { default as registerMintAdder } from 'components/blocks/sheets/mint-adder';
import { default as registerTransactionMessage } from 'components/blocks/sheets/transaction-message';
import { default as registerEmojiPicker } from 'components/blocks/sheets/emoji-picker';
import { default as registerMintBalance } from 'components/blocks/sheets/mint-balance';
import { default as registerMintReallocation } from 'components/blocks/sheets/mint-reallocation';
import { default as registerEmail } from 'components/blocks/sheets/email';
import { default as registerVideo } from 'components/blocks/sheets/video';
import { default as registerLightningMPP } from 'components/blocks/sheets/lightning-mpp';

export function registerAllSheets({ context }: { context?: 'global' }) {
  registerExample({ context });
  registerPopup({ context });
  registerNpubcashSelector({ context });
  registerMintAccepter({ context });
  registerReallocateAccepter({ context });
  registerButtonHandler({ context });
  registerDelete({ context });
  registerMintAdder({ context });
  registerTransactionMessage({ context });
  registerEmojiPicker({ context });
  registerMintBalance({ context });
  registerMintReallocation({ context });
  registerEmail({ context });
  registerVideo({ context });
  registerLightningMPP({ context });
}
