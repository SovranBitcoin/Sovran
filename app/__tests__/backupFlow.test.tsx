import { AppState } from 'react-native';
import { Redirect } from 'expo-router';
import TestRenderer, { act } from 'react-test-renderer';
import { BackupFlowProvider } from '@/features/backup/BackupFlowProvider';
import { BackupIntroScreen } from '@/features/backup/screens/BackupIntroScreen';
import { BackupWordsScreen } from '@/features/backup/screens/BackupWordsScreen';
import { BackupVerifyScreen } from '@/features/backup/screens/BackupVerifyScreen';
import { BackupDoneScreen } from '@/features/backup/screens/BackupDoneScreen';
import { buildVerifyPlan } from '@/features/backup/lib/verifyPlan';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockPhrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
let mockMode = false;
let mockValue: string | null = mockPhrase;
let mockFocused = true;
const mockMark = jest.fn();
const mockDismiss = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockLog = jest.fn();
const mockMnemonic = jest.fn();
const mockNavigation = { getParent: () => ({ goBack: mockBack }) };
jest.mock('expo-router', () => ({ Redirect: 'Redirect', useNavigation: () => mockNavigation }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => mockBack(),
    dismiss: () => mockDismiss(),
  },
}));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  useMnemonic: (autoLoad: boolean) => {
    mockMnemonic(autoLoad);
    return { value: autoLoad ? mockValue : null, loading: false };
  },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (s: { mockMode: boolean }) => unknown) => selector({ mockMode }),
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: () => ({ markRecoveryPhraseVerified: mockMark }) },
}));
jest.mock('@/shared/stores/global/ctaStore', () => ({
  useCtaStore: { getState: () => ({ startBackup: jest.fn(), dismiss: mockDismiss }) },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: (...args: unknown[]) => mockLog(...args) },
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Error: 'error' },
}));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'success-foreground' }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'Footer' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
let view: TestRenderer.ReactTestRenderer;
let current: React.ReactNode;
function show(screen: React.ReactNode) {
  current = screen;
  act(() => {
    if (view) view.update(<BackupFlowProvider>{screen}</BackupFlowProvider>);
    else view = TestRenderer.create(<BackupFlowProvider>{screen}</BackupFlowProvider>);
  });
}
function press(id: string) {
  act(() => {
    view.root.findByProps({ testID: id }).props.onPress();
  });
}
function answer(index: number) {
  press(`backup-choice-${index}`);
  act(() => jest.advanceTimersByTime(250));
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Date, 'now').mockReturnValue(123);
  mockMode = false;
  mockValue = mockPhrase;
  mockFocused = true;
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined!;
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it('reveals twelve rows without marking verification; hides words and choices when unfocused', () => {
  show(<BackupWordsScreen />);
  for (let i = 1; i <= 12; i++)
    expect(view.root.findByProps({ testID: `backup-word-${i}` })).toBeTruthy();
  expect(mockMark).not.toHaveBeenCalled();
  mockFocused = false;
  show(<BackupWordsScreen />);
  expect(view.root.findAllByProps({ testID: 'backup-word-1' })).toHaveLength(0);
  show(<BackupVerifyScreen />);
  expect(view.root.findAllByProps({ testID: 'backup-choice-0' })).toHaveLength(0);
});
it('retries one word, preserves progress on reveal, blocks double taps and certifies only all twelve', () => {
  const plan = buildVerifyPlan(mockPhrase.split(' '), 123);
  show(<BackupVerifyScreen />);
  answer(plan[0].answerIndex);
  const wrong = (plan[1].answerIndex + 1) % 3;
  answer(wrong);
  answer(wrong);
  expect(view.root.findByProps({ testID: 'backup-verify-progress' }).props.accessibilityLabel).toBe(
    '2 of 12'
  );
  press('backup-show-again');
  expect(mockBack).toHaveBeenCalled();
  show(<BackupWordsScreen />);
  show(<BackupVerifyScreen />);
  expect(view.root.findByProps({ testID: 'backup-verify-progress' }).props.accessibilityLabel).toBe(
    '2 of 12'
  );
  press(`backup-choice-${plan[1].answerIndex}`);
  press(`backup-choice-${plan[1].answerIndex}`);
  act(() => jest.advanceTimersByTime(250));
  expect(view.root.findByProps({ testID: 'backup-verify-progress' }).props.accessibilityLabel).toBe(
    '3 of 12'
  );
  for (const question of plan.slice(2)) answer(question.answerIndex);
  expect(mockReplace).toHaveBeenCalledWith('/(backup-flow)/done');
  expect(mockMark).not.toHaveBeenCalled();
  show(<BackupDoneScreen />);
  expect(mockMark).toHaveBeenCalledTimes(1);
  show(<BackupDoneScreen />);
  expect(mockMark).toHaveBeenCalledTimes(1);
  press('backup-done-button');
  expect(mockBack).toHaveBeenCalled();
  expect(
    mockLog.mock.calls.every(
      ([event, fields]) =>
        /^backup\.flow\./.test(event) && (!fields || Object.keys(fields).join() === 'position')
    )
  ).toBe(true);
});
it('cannot certify from a direct done route or missing mnemonic', () => {
  show(<BackupDoneScreen />);
  expect(mockMark).not.toHaveBeenCalled();
  expect(view.root.findAllByType(Redirect)).toHaveLength(1);
  mockValue = null;
  show(<BackupWordsScreen />);
  expect(view.root.findByProps({ testID: 'backup-written' }).props.disabled).toBe(true);
});
it('cancels pending advancement when the verify screen loses focus', () => {
  show(<BackupVerifyScreen />);
  press(`backup-choice-${buildVerifyPlan(mockPhrase.split(' '), 123)[0].answerIndex}`);
  mockFocused = false;
  show(current);
  act(() => jest.advanceTimersByTime(250));
  mockFocused = true;
  show(current);
  expect(view.root.findByProps({ testID: 'backup-verify-progress' }).props.accessibilityLabel).toBe(
    '1 of 12'
  );
});
it('practices in Mock Mode without reading or certifying the real mnemonic, and resets on mode change', () => {
  mockMode = true;
  show(<BackupVerifyScreen />);
  for (const entry of buildVerifyPlan(mockPhrase.split(' '), 0)) answer(entry.answerIndex);
  show(<BackupDoneScreen />);
  expect(mockMark).not.toHaveBeenCalled();
  expect(mockMnemonic).toHaveBeenCalledWith(false);
  mockMode = false;
  show(<BackupDoneScreen />);
  expect(view.root.findAllByType(Redirect)).toHaveLength(1);
  expect(mockMark).not.toHaveBeenCalled();
});
it('Not now snoozes the reminder and closes the intro', () => {
  show(<BackupIntroScreen />);
  press('backup-not-now');
  expect(mockDismiss).toHaveBeenCalledWith('backup-recovery-phrase', false);
  expect(mockMark).not.toHaveBeenCalled();
});
