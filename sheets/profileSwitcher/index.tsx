/**
 * @fileoverview ProfileSwitcher Sheet - Multi-account profile switching
 *
 * @description
 * Sheet for switching between profiles and adding new ones. Use profileSwitcherPopup
 * from @/shared/lib/popup to open.
 *
 * **Usage:**
 * ```typescript
 * import { profileSwitcherPopup } from '@/shared/lib/popup';
 *
 * profileSwitcherPopup({
 *   onSwitchProfile: (accountIndex) => { ... },
 *   onAddProfile: () => { ... },
 *   onImportProfile: (npubNumber) => { ... },
 * });
 * ```
 */

import React, { useState } from 'react';
import { ProfileList } from './routes/profileList';
import { ImportNsec } from './routes/importNsec';
import type { ActionSheetPayloads } from '@/shared/lib/popup';

type ProfileSwitcherRoute = 'profile-list' | 'import-nsec';

interface ProfileSwitcherContentProps {
  payload: ActionSheetPayloads['profile-switcher'];
  close: () => void;
}

export function ProfileSwitcherContent({ payload, close }: ProfileSwitcherContentProps) {
  const [route, setRoute] = useState<ProfileSwitcherRoute>('profile-list');

  if (route === 'import-nsec') {
    return (
      <ImportNsec
        payload={payload}
        close={close}
        onBack={() => setRoute('profile-list')}
      />
    );
  }

  return (
    <ProfileList
      payload={payload}
      close={close}
      onNavigateToImport={() => setRoute('import-nsec')}
    />
  );
}
