import { getPublicKey, nip19 } from 'nostr-tools';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';
import { resolveIdentityName } from '@/shared/lib/identity';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { useProfileStore } from '@/shared/stores/global/profileStore';

import type { ProfileSwitcherAction } from '../actionSheetTypes';
import { actionMenuPopup, type ActionMenuItem, type ActionMenuSection } from './actionMenu';

// ---------------------------------------------------------------------------
// Profile switcher — dispatched through `actionMenuPopup` so each profile +
// the Generate / Import affordances render as `Menu.Item`s on the canonical
// heroui-native `Menu presentation="bottom-sheet"` surface (same look as
// "as Lightning" / "as Ecash" / "as Onchain" / "as Text" / "as Emoji").
// Profiles are split into Imported / Derived tabs (`sections`); tapping a
// tab scrolls the body. `footerButtons` keeps Generate / Import sticky at
// the bottom; tapping Import chains a second `actionMenuPopup` with `inputs`
// for the nsec form.
// ---------------------------------------------------------------------------

type ProfileSwitcherPopupPayload = {
  onRequestAction: (action: ProfileSwitcherAction) => void;
};

export function profileSwitcherPopup(payload: ProfileSwitcherPopupPayload): void {
  const state = useProfileStore.getState();
  const profiles = state.profiles;
  const activeIndex = state.activeAccountIndex;

  const buildProfileButton = (profile: (typeof profiles)[number]): ActionMenuItem => {
    const isActive = profile.accountIndex === activeIndex;
    const displayName = resolveIdentityName({
      pubkey: profile.pubkey,
      overrideName: profile.cachedDisplayName,
    });
    return {
      testID: `profile-row-${profile.accountIndex}`,
      text: displayName,
      disabled: isActive,
      iconNode: (
        <Avatar
          state={profile.cachedPicture ? 'image' : 'fallback'}
          seed={profile.pubkey}
          picture={profile.cachedPicture}
          name={displayName}
          size={36}
        />
      ),
      suffix: (
        <HStack align="center" spacing={6}>
          {profile.cachedBalanceSats != null ? (
            <AmountFormatter
              amount={profile.cachedBalanceSats}
              unit="sat"
              size={13}
              weight="medium"
            />
          ) : null}
          {isActive ? <Icon name="mdi:check-circle" size={18} /> : null}
        </HStack>
      ),
      onPress: () => {
        payload.onRequestAction({ type: 'switch', accountIndex: profile.accountIndex });
      },
    };
  };

  const importedButtons = profiles.filter((p) => p.source === 'imported').map(buildProfileButton);
  const derivedButtons = profiles.filter((p) => p.source !== 'imported').map(buildProfileButton);

  // Only render tabs that have profiles — when a user has only derived
  // accounts (or only imported), a single-tab bar would be useless chrome.
  const sections = [
    importedButtons.length > 0 && {
      id: 'imported',
      anchor: {
        icon: <Icon name="mdi:key-variant" size={14} />,
        label: 'Imported',
        testID: 'profile-tab-imported',
      },
      buttons: importedButtons,
    },
    derivedButtons.length > 0 && {
      id: 'derived',
      anchor: {
        icon: <Icon name="mdi:tree" size={14} />,
        label: 'Derived',
        testID: 'profile-tab-derived',
      },
      buttons: derivedButtons,
    },
  ].filter(Boolean) as ActionMenuSection[];

  actionMenuPopup({
    title: 'Select profile',
    sections,
    footerButtons: [
      {
        testID: 'profile-create',
        text: 'Generate new account',
        icon: 'la:user-plus',
        onPress: () => {
          payload.onRequestAction({ type: 'create' });
        },
      },
      {
        testID: 'profile-import',
        text: 'Import Nostr',
        icon: 'mdi:key-variant',
        // Open the nsec input as a *separate* menu — the host
        // auto-dismisses this one (no `keepOpen`); we wait out the
        // close animation, then dispatch the second `actionMenuPopup`.
        // The delay is sized to gorhom's default sheet close (~200ms)
        // plus a small buffer so the open isn't cancelled by the
        // still-running close.
        onPress: () => {
          setTimeout(() => openProfileImportMenu(payload), 300);
        },
      },
    ],
  });
}

function openProfileImportMenu(payload: ProfileSwitcherPopupPayload): void {
  actionMenuPopup({
    title: 'Import Nostr',
    inputs: [
      {
        id: 'nsec',
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
        payload.onRequestAction({
          type: 'import',
          nsec: trimmed,
          pubkeyHex,
          accountIndex: pubkeyToAccountNumber(pubkeyHex),
        });
        close();
      },
    },
  });
}
