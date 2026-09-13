import TestRenderer, { act } from 'react-test-renderer';

import {
  createRecoveryChallenge,
  type RecoveryQuestion,
} from '@/features/settings/lib/recoveryPhraseChallenge';
import { RecoveryPhraseQuiz } from '@/features/settings/screens/RecoveryPhraseConfirmScreen';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  useMnemonic: () => ({ value: null, loading: false }),
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: jest.fn() },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'View',
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  StyleSheet: { flatten: (style: unknown) => style },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View' },
  useSharedValue: (initial: number) => {
    const shared = {
      value: initial,
      get: () => shared.value,
      set: (next: number) => {
        shared.value = next;
      },
    };
    return shared;
  },
  useAnimatedStyle: () => ({}),
  withSequence: jest.fn(),
  withTiming: jest.fn(),
  ReduceMotion: { System: 'system' },
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: ({ text, ...props }: { text: string }) => {
    return jest.requireActual<typeof import('react')>('react').createElement('Button', props, text);
  },
}));
const questions: RecoveryQuestion[] = [1, 5, 9].map((position) => ({
  position,
  answer: 'correct',
  choices: ['wrong', 'correct', 'three', 'four', 'five', 'six'],
}));
it('requires three correct picks, permits retry, and completes only once', () => {
  const complete = jest.fn();
  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<RecoveryPhraseQuiz questions={questions} onComplete={complete} />);
  });
  const pick = (index: number) => {
    act(() => {
      view.root.findByProps({ testID: `recovery-choice-${index}` }).props.onPress();
    });
  };
  pick(0);
  expect(view.root.findByProps({ testID: 'recovery-phrase-incorrect' })).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).toContain('1');
  pick(1);
  expect(view.root.findAllByProps({ testID: 'recovery-phrase-incorrect' })).toHaveLength(0);
  pick(1);
  expect(complete).not.toHaveBeenCalled();
  pick(1);
  pick(1);
  expect(complete).toHaveBeenCalledTimes(1);
  act(() => view.unmount());
});
it('chooses distinct positions and six distinct choices even for repeated words', () => {
  // Public BIP-39 zero-entropy test vector; never an app wallet.
  const mnemonic = `${'abandon '.repeat(11)}about`;
  const quiz = createRecoveryChallenge(mnemonic, () => 0.5);
  expect(quiz).toHaveLength(3);
  expect(new Set(quiz.map((q) => q.position)).size).toBe(3);
  for (const question of quiz) {
    expect(new Set(question.choices).size).toBe(6);
    expect(question.choices).toContain(question.answer);
    expect(question.answer).toBe(mnemonic.split(' ')[question.position - 1]);
  }
  expect(createRecoveryChallenge('invalid')).toEqual([]);
});
