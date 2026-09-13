import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  /** Intro mount: starts the grace timer and logs the open once per session. */
  open: () => void;
  /** Screens that render or check words ask for the phrase; the prompt page never does. */
  ensureWords: () => void;
}
const BackupContext = createContext<BackupSession | null>(null);

function BackupSessionProvider({ children, mockMode }: { children: ReactNode; mockMode: boolean }) {
  const demoPhrase = getBackupDemoPhrase(mockMode);
  const [wordsWanted, setWordsWanted] = useState(false);
  const { value, loading } = useMnemonic(demoPhrase === null && wordsWanted);
  const mnemonic = demoPhrase ?? value;
  const words = mnemonic && validateMnemonic(mnemonic, wordlist) ? mnemonic.split(' ') : [];
  const [attempt] = useState(() => (demoPhrase ? 0 : Date.now()));
  const plan = buildVerifyPlan(words, attempt);
  const [progress, setProgress] = useState({ position: 0, missesAtPosition: 0 });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const completed = useRef(false);
  const opened = useRef(false);
  // The compiler memoizes these; manual useCallback here could not be preserved.
  const open = () => {
    if (opened.current) return;
    opened.current = true;
    useCtaStore.getState().startBackup();
    log.info('backup.flow.opened');
  };
  const ensureWords = () => setWordsWanted(true);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => {
      subscription.remove();
      if (opened.current && !completed.current) log.info('backup.flow.abandoned');
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
        loading: demoPhrase === null && (loading || !wordsWanted),
        active,
        demo: demoPhrase !== null,
        finish: () => {
          completed.current = true;
        },
        open,
        ensureWords,
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
