import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import PasscodeScreen from './PasscodeScreen';
import { selectPasscode } from 'redux/settings';

const PasscodeGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storedPasscode = useSelector(selectPasscode);
  const [unlocked, setUnlocked] = useState(!storedPasscode);

  useEffect(() => {
    if (!storedPasscode) setUnlocked(true);
  }, [storedPasscode]);

  if (storedPasscode && !unlocked) {
    return <PasscodeScreen passcode={storedPasscode} onSuccess={() => setUnlocked(true)} />;
  }

  return <>{children}</>;
};

export default PasscodeGate;
