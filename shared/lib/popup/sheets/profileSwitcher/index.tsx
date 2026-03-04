/**
 * @fileoverview ProfileSwitcher Sheet - Multi-account profile switching
 *
 * Route state is controlled by PopupHost so the sticky footerComponent
 * can react to route changes (profile-list footer vs import-nsec inline).
 */

import React from 'react';
import { View } from 'react-native';
import Animated, {
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { ProfileList } from './profileList';
import { ImportNsec } from './importNsec';
import type { ActionSheetPayloads } from '../../actionSheetTypes';

type ProfileRoute = 'profile-list' | 'import-nsec';
type ProfileNavDirection = 'forward' | 'back';

interface ImportNsecFooterState {
  onImport: () => void;
  isDisabled: boolean;
  isImporting: boolean;
}

interface ProfileSwitcherContentProps {
  payload: ActionSheetPayloads['profile-switcher'];
  close: () => void;
  route: ProfileRoute;
  navDirection: ProfileNavDirection;
  onBack: () => void;
  onImportFooterStateChange: (state: ImportNsecFooterState) => void;
}

export function ProfileSwitcherContent({
  payload,
  close,
  route,
  navDirection,
  onBack,
  onImportFooterStateChange,
}: ProfileSwitcherContentProps) {
  const entering =
    navDirection === 'forward' ? SlideInRight.duration(220) : SlideInLeft.duration(220);
  const exiting = navDirection === 'forward' ? SlideOutLeft.duration(220) : SlideOutRight.duration(220);

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View key={route} style={{ flex: 1 }} entering={entering} exiting={exiting}>
        {route === 'import-nsec' ? (
          <ImportNsec
            payload={payload}
            close={close}
            onFooterStateChange={onImportFooterStateChange}
          />
        ) : (
          <ProfileList payload={payload} close={close} />
        )}
      </Animated.View>
    </View>
  );
}
