import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { resolveIdentityName } from '@/shared/lib/identity';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { openPicker } from '@/shared/lib/picker/openPicker';
import type { PickerOption, PickerRequest, PickerSection } from '@/shared/lib/picker/types';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';

import type { ProfileSwitcherAction } from '../actionSheetTypes';
import { actionMenuPopup } from './actionMenu';

// ---------------------------------------------------------------------------
// Profile switcher — the picker sheet (`openPicker`), the same sheet as
// Select mint. Profiles are split into Imported / Derived tabs; Generate and
// Import sit in the footer. Import opens the nsec form, still an
// `actionMenuPopup`, once the sheet has gone: a menu opened sooner paints
// beneath the closing iPhone sheet.
// ---------------------------------------------------------------------------

type ProfileSwitcherPayload = {
  onRequestAction: (action: ProfileSwitcherAction) => void;
};

function profileOption(profile: ProfileEntry, activeIndex: number): PickerOption {
  const isActive = profile.accountIndex === activeIndex;
  const displayName = resolveIdentityName({
    pubkey: profile.pubkey,
    overrideName: profile.cachedDisplayName,
  });
  return {
    // `accountIndex` is the profile's derivation account — its stable
    // identity, not a position in this list.
    id: String(profile.accountIndex),
    testID: `profile-row-${profile.accountIndex}`,
    title: displayName,
    leading: {
      avatar: { picture: profile.cachedPicture, seed: profile.pubkey, name: displayName },
    },
    trailing:
      profile.cachedBalanceSats != null ? (
        <AmountFormatter amount={profile.cachedBalanceSats} unit="sat" size={13} weight="medium" />
      ) : undefined,
    // The active profile is the current choice: checked, and inert to
    // re-selection.
    selected: isActive,
    disabled: isActive,
  };
}

function profileSwitcherRequest(
  profiles: readonly ProfileEntry[],
  activeIndex: number
): PickerRequest {
  const sections: PickerSection[] = [
    {
      id: 'imported',
      title: 'Imported',
      icon: 'mdi:key-variant',
      testID: 'profile-tab-imported',
      options: profiles
        .filter((p) => p.source === 'imported')
        .map((p) => profileOption(p, activeIndex)),
    },
    {
      id: 'derived',
      title: 'Derived',
      icon: 'mdi:tree',
      testID: 'profile-tab-derived',
      options: profiles
        .filter((p) => p.source !== 'imported')
        .map((p) => profileOption(p, activeIndex)),
    },
  ];
  return {
    title: 'Select profile',
    testID: 'profile-switcher',
    sections,
    actions: [
      { id: 'import', title: 'Import Nostr', icon: 'mdi:key-variant', testID: 'profile-import' },
      {
        id: 'create',
        title: 'Generate new account',
        icon: 'la:user-plus',
        variant: 'primary',
        testID: 'profile-create',
      },
    ],
  };
}

export async function openProfileSwitcher(payload: ProfileSwitcherPayload): Promise<void> {
  const { profiles, activeAccountIndex } = useProfileStore.getState();
  const picker = openPicker(profileSwitcherRequest(profiles, activeAccountIndex));
  const result = await picker.result;
  if (result.kind === 'dismissed') return;
  // Act once the sheet has gone. A switch remounts the account's screens,
  // the sheet included, and the import form would paint beneath it.
  await picker.closed;
  if (result.kind === 'option') {
    const profile = profiles.find((p) => String(p.accountIndex) === result.id);
    if (profile) payload.onRequestAction({ type: 'switch', accountIndex: profile.accountIndex });
  } else if (result.id === 'create') {
    payload.onRequestAction({ type: 'create' });
  } else if (result.id === 'import') {
    openProfileImportMenu(payload);
  }
}

function openProfileImportMenu(payload: ProfileSwitcherPayload): void {
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
