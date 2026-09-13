import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { log } from '@/shared/lib/logger';
import { buildVerifyPlan, type VerifyState, type VerifyQuestion } from './lib/verifyPlan';
import { getBackupDemoPhrase } from './lib/demoPhrase';

interface BackupSession {
  words: string[];
  plan: VerifyQuestion[];
  progress: { position: number; missesAtPosition: number };
  setProgress: (state: VerifyState) => void;
  loading: boolean;
  active: boolean;
  demo: boolean;
  finish: () => void;
}
const BackupContext = createContext<BackupSession | null>(null);

function BackupSessionProvider({ children, mockMode }: { children: ReactNode; mockMode: boolean }) {
  const demoPhrase = getBackupDemoPhrase(mockMode);
  const { value, loading } = useMnemonic(demoPhrase === null);
  const mnemonic = demoPhrase ?? value;
  const words = mnemonic && validateMnemonic(mnemonic, wordlist) ? mnemonic.split(' ') : [];
  const [attempt] = useState(() => (demoPhrase ? 0 : Date.now()));
  const plan = buildVerifyPlan(words, attempt);
  const [progress, setProgress] = useState({ position: 0, missesAtPosition: 0 });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const completed = useRef(false);
  useEffect(() => {
    useCtaStore.getState().startBackup();
    log.info('backup.flow.opened');
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => {
      subscription.remove();
      if (!completed.current) log.info('backup.flow.abandoned');
    };
  }, []);
  return (
    <BackupContext.Provider
      value={{
        words,
        plan,
        progress,
        setProgress: ({ position, missesAtPosition }) =>
          setProgress({ position, missesAtPosition }),
        loading: demoPhrase === null && loading,
        active,
        demo: demoPhrase !== null,
        finish: () => {
          completed.current = true;
        },
      }}>
      {children}
    </BackupContext.Provider>
  );
}

export function BackupFlowProvider({ children }: { children: ReactNode }) {
  const mockMode = useSettingsStore((state) => state.mockMode);
  // Changing modes invalidates any in-flight answers and prevents demo certification.
  return (
    <BackupSessionProvider key={String(mockMode)} mockMode={mockMode}>
      {children}
    </BackupSessionProvider>
  );
}

export function useBackupSession(): BackupSession {
  const session = useContext(BackupContext);
  if (!session) throw new Error('Backup screen requires its flow');
  return session;
}
