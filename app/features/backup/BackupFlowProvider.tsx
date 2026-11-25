import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useRootNavigationState } from 'expo-router';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { log } from '@/shared/lib/logger';
import { buildVerifyPlan, type VerifyState, type VerifyQuestion } from './lib/verifyPlan';
import { getBackupDemoPhrase } from './lib/demoPhrase';
import { isBackupJourneyOpen } from './lib/journey';

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

/** One journey through the backup pages: opened, answered, then finished or left. */
interface SessionState {
  /** Counts sessions, so each one opens, finishes or is abandoned once. */
  id: number;
  mockMode: boolean;
  /** Whether a backup page was on the root stack at the last render. */
  journeyOpen: boolean;
  wordsWanted: boolean;
  attempt: number;
  progress: { position: number; missesAtPosition: number };
  /** The real phrase, held only for this session. */
  mnemonic: string | null;
  mnemonicLoading: boolean;
}

const freshSession = (id: number, mockMode: boolean, journeyOpen: boolean): SessionState => ({
  id,
  mockMode,
  journeyOpen,
  wordsWanted: false,
  attempt: 0,
  progress: { position: 0, missesAtPosition: 0 },
  mnemonic: null,
  mnemonicLoading: true,
});

interface MnemonicRead {
  value: string | null;
  loading: boolean;
}

/**
 * Reads the phrase while mounted. The provider outlives every journey, so the
 * read lives here, mounted for the session that asked, and its copy in the
 * session is dropped when the session ends.
 */
function MnemonicSource({ onRead }: { onRead: (read: MnemonicRead) => void }) {
  const { value, loading } = useMnemonic(true);
  useEffect(() => onRead({ value, loading }), [value, loading, onRead]);
  return null;
}

function BackupSessionProvider({
  children,
  mockMode,
  journeyOpen,
}: {
  children: ReactNode;
  mockMode: boolean;
  journeyOpen: boolean;
}) {
  const demoPhrase = getBackupDemoPhrase(mockMode);
  const [session, setSession] = useState(() => freshSession(0, mockMode, journeyOpen));
  // Leaving the journey, or changing modes, starts the next session afresh:
  // answers never carry over, and demo answers never certify a real wallet.
  // Entering it keeps the session the first backup page already opened.
  if (session.mockMode !== mockMode || session.journeyOpen !== journeyOpen) {
    const ended = session.mockMode !== mockMode || (session.journeyOpen && !journeyOpen);
    setSession(
      ended ? freshSession(session.id + 1, mockMode, journeyOpen) : { ...session, journeyOpen }
    );
  }
  const sessionId = session.id;
  const mnemonic = demoPhrase ?? session.mnemonic;
  const words = mnemonic && validateMnemonic(mnemonic, wordlist) ? mnemonic.split(' ') : [];
  const plan = buildVerifyPlan(words, session.attempt);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const openedSession = useRef<number | null>(null);
  const completedSession = useRef<number | null>(null);
  // The compiler memoizes these; manual useCallback here could not be preserved.
  const open = () => {
    if (openedSession.current === sessionId) return;
    openedSession.current = sessionId;
    useCtaStore.getState().startBackup();
    log.info('backup.flow.opened');
  };
  const ensureWords = () => {
    if (session.wordsWanted) return;
    // Each session asks its questions in a fresh order; practice keeps one.
    const attempt = demoPhrase ? 0 : Date.now();
    setSession((current) =>
      current.id !== sessionId || current.wordsWanted
        ? current
        : { ...current, wordsWanted: true, attempt }
    );
  };
  const onRead = ({ value, loading }: MnemonicRead) =>
    setSession((current) =>
      current.id !== sessionId ||
      (current.mnemonic === value && current.mnemonicLoading === loading)
        ? current
        : { ...current, mnemonic: value, mnemonicLoading: loading }
    );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => subscription.remove();
  }, []);
  useEffect(
    () => () => {
      if (openedSession.current === sessionId && completedSession.current !== sessionId) {
        log.info('backup.flow.abandoned');
      }
    },
    [sessionId]
  );
  return (
    <BackupContext.Provider
      value={{
        words,
        plan,
        progress: session.progress,
        setProgress: ({ position, missesAtPosition }) =>
          setSession((current) =>
            current.id !== sessionId
              ? current
              : { ...current, progress: { position, missesAtPosition } }
          ),
        loading: demoPhrase === null && (session.mnemonicLoading || !session.wordsWanted),
        active,
        demo: demoPhrase !== null,
        finish: () => {
          completedSession.current = sessionId;
        },
        open,
        ensureWords,
      }}>
      {demoPhrase === null && session.wordsWanted ? (
        <MnemonicSource key={sessionId} onRead={onRead} />
      ) : null}
      {children}
    </BackupContext.Provider>
  );
}

/**
 * The backup session, above the root stack so one session survives every push
 * from the intro to done. It resets when the last backup page closes and when
 * Mock Mode changes, and the account scope above it resets it per account.
 */
export function BackupFlowProvider({ children }: { children: ReactNode }) {
  const mockMode = useSettingsStore((state) => state.mockMode);
  const journeyOpen = isBackupJourneyOpen(useRootNavigationState()?.routes);
  return (
    <BackupSessionProvider mockMode={mockMode} journeyOpen={journeyOpen}>
      {children}
    </BackupSessionProvider>
  );
}

export function useBackupSession(): BackupSession {
  const session = useContext(BackupContext);
  if (!session) throw new Error('Backup screen requires its flow');
  return session;
}
