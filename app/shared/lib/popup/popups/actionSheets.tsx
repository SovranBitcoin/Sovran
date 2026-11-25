import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { useProfileStore } from '@/shared/stores/global/profileStore';

import { actionMenuPopup } from './actionMenu';

// ---------------------------------------------------------------------------
// Import account — the nsec form the account drawer opens once it has closed
// (a menu opened sooner paints beneath the closing iPhone drawer).
// ---------------------------------------------------------------------------

/** A checked nsec, ready for `importAndSwitchProfile`. */
export type ProfileImportRequest = { nsec: string; pubkeyHex: string; accountIndex: number };

type ProfileImportPayload = {
  onImport: (request: ProfileImportRequest) => void;
};

export function openProfileImportMenu(payload: ProfileImportPayload): void {
  actionMenuPopup({
    title: 'Import Nostr',
    inputs: [
      {
        id: 'nsec',
        accessibilityLabel: 'Nostr private key',
        placeholder: 'nsec1...',
        secureTextEntry: true,
        autoCapitalize: 'none',
        autoCorrect: false,
        description: 'Paste your Nostr private key (nsec) to import an existing account.',
      },
    ],
    primaryAction: {
      text: 'Import',
      loadingText: 'Importing...',
      icon: 'mdi:key-variant',
      testID: 'profile-import-submit',
      isDisabled: (v) => !v.nsec.trim(),
      onPress: (values, { setError, close }) => {
        const trimmed = values.nsec.trim();
        if (!trimmed) {
          setError('Please enter an nsec.');
          return;
        }
        let privateKeyBytes: Uint8Array;
        try {
          const decoded = nip19.decode(trimmed);
          if (decoded.type !== 'nsec') {
            setError('Invalid format. Must be an nsec (nsec1...).');
            return;
          }
          privateKeyBytes = decoded.data;
        } catch {
          setError('Invalid nsec format.');
          return;
        }
        let pubkeyHex: string;
        try {
          pubkeyHex = getPublicKey(privateKeyBytes);
        } catch {
          setError('Failed to derive public key from nsec.');
          return;
        }
        if (useProfileStore.getState().hasPubkey(pubkeyHex)) {
          setError('This identity already exists as a profile.');
          return;
        }
        payload.onImport({
          nsec: trimmed,
          pubkeyHex,
          accountIndex: pubkeyToAccountNumber(pubkeyHex),
        });
        close();
      },
    },
  });
}
