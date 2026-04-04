import React, { useState, useEffect } from 'react';
import PasscodeScreen from './PasscodeScreen';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { log } from '@/shared/lib/logger';

const PasscodeGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const passcode = useSettingsStore((state) => state.passcode);
  const [unlocked, setUnlocked] = useState(!passcode);

  useEffect(() => {
    if (!passcode) {
      log.debug('auth.gate.no_passcode_set');
      setUnlocked(true);
    }
  }, [passcode]);

  if (passcode && !unlocked) {
    log.info('auth.gate.locked', { reason: 'passcode_required' });
    return <PasscodeScreen passcode={passcode} onSuccess={() => {
      log.info('auth.gate.unlocked');
      setUnlocked(true);
    }} />;
  }

  return <>{children}</>;
};

export default PasscodeGate;
