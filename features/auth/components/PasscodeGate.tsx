import React, { useState, useEffect } from 'react';
import PasscodeScreen from './PasscodeScreen';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

const PasscodeGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const passcode = useSettingsStore((state) => state.passcode);
  const [unlocked, setUnlocked] = useState(!passcode);

  useEffect(() => {
    if (!passcode) setUnlocked(true);
  }, [passcode]);

  if (passcode && !unlocked) {
    return <PasscodeScreen passcode={passcode} onSuccess={() => setUnlocked(true)} />;
  }

  return <>{children}</>;
};

export default PasscodeGate;
