import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { actionMenuPopup } from '@/shared/lib/popup';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { recoverMnemonicSession } from './profileSessionOrchestrator';
import { restartApp } from './appRestart';

export function openMnemonicRecovery(): void {
  actionMenuPopup({
    title: 'Enter recovery phrase',
    inputs: [
      {
        id: 'recovery-phrase',
        label: 'Recovery phrase',
        secureTextEntry: true,
        autoCapitalize: 'none',
        autoCorrect: false,
      },
    ],
    footerButtons: [{ text: 'Cancel', testID: 'key-recovery-cancel' }],
    primaryAction: {
      text: 'Recover account',
      testID: 'secure-recovery-submit',
      isDisabled: (values) => !values['recovery-phrase'].trim(),
      onPress: async (values, { setError, close }) => {
        const mnemonic = values['recovery-phrase'].trim().toLowerCase().split(/\s+/).join(' ');
        if (mnemonic.split(' ').length !== 12 || !bip39.validateMnemonic(mnemonic, wordlist)) {
          setError('Enter a valid 12-word recovery phrase.');
          return;
        }
        if (!(await recoverMnemonicSession(mnemonic))) {
          setError(
            'Recovery could not finish. Retry, or close and reopen the app if the phrase was saved.'
          );
          return;
        }
        close();
      },
    },
  });
}

export function openNsecRecovery(): void {
  const profile = useProfileStore.getState().getActiveProfile();
  if (!profile) return;
  actionMenuPopup({
    title: 'Re-import Nostr key',
    inputs: [
      {
        id: 'recovery-nsec',
        label: 'Nostr private key',
        secureTextEntry: true,
        autoCapitalize: 'none',
        autoCorrect: false,
      },
    ],
    footerButtons: [{ text: 'Cancel', testID: 'key-recovery-cancel' }],
    primaryAction: {
      text: 'Re-import',
      testID: 'profile-reimport-submit',
      onPress: async (values, { setError, close }) => {
        const nsec = values['recovery-nsec'].trim();
        try {
          const decoded = nip19.decode(nsec);
          if (decoded.type !== 'nsec' || getPublicKey(decoded.data) !== profile.pubkey) {
            setError('This key does not match the saved account.');
            return;
          }
        } catch {
          setError('Enter a valid Nostr private key (nsec).');
          return;
        }
        if (!(await storeImportedNsec(profile.pubkey, nsec))) {
          setError('The key could not be saved. Try again.');
          return;
        }
        if (!restartApp()) {
          setError('Key saved. Close and reopen the app to continue.');
          return;
        }
        close();
      },
    },
  });
}
