/**
 * The composer's image button is offered for the model a send goes to. That
 * model is chosen against the wallet's spendable sats (the chip and the send
 * both read `useRoutstrFunds`), so the button must read the same balance, not
 * the old key balance `routstrStore.balance`, which nothing writes any more.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { emptyLineup, type LineupEntry, type LineupPricing } from '@/shared/lib/routstr/lineup';
import { AiChatScreen } from '@/features/ai/screens/AiChatScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pricing = (sats: number): LineupPricing => ({
  prompt: null,
  completion: null,
  request: null,
  image: null,
  max_cost: sats,
});
const entry = (modelId: string, reserveSats: number, visionInput: boolean): LineupEntry => ({
  modelId,
  displayName: modelId,
  contextLength: 128_000,
  created: 1,
  visionInput,
  satsPricing: pricing(reserveSats),
});

const lineup = emptyLineup();
// The chosen slot takes images but costs more than the wallet holds; the next
// rung of the chain is affordable and text-only, so that is where a send goes.
lineup.openai = {
  ...lineup.openai,
  max: entry('vision-max', 5_000, true),
  pro: entry('text-pro', 20, false),
};

const mockRoutstr = {
  selectedTier: 'max',
  selectedProvider: 'openai',
  // Nothing writes this any more: null on a new install.
  balance: null as number | null,
  lineup: lineup as typeof lineup | null,
  lastKnownLineup: null as { derivedAt: number; lineup: typeof lineup } | null,
  conversationHistory: [],
  activeChildren: {},
  currentSessionId: 'session-1',
  setActiveBranch: jest.fn(),
  createSession: jest.fn(),
};
let mockFunds: { balanceSats: number } | null = { balanceSats: 1_000 };

jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: Object.assign(
    (select: (state: typeof mockRoutstr) => unknown) => select(mockRoutstr),
    { getState: () => mockRoutstr }
  ),
}));
jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({ useRoutstrFunds: () => mockFunds }));
jest.mock('@/features/ai/hooks/useAiSend', () => ({
  useAiSend: () => ({ send: jest.fn(), retry: jest.fn(), isSending: false }),
}));
const mockSettings = { mockMode: false };
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (select: (s: typeof mockSettings) => unknown) => select(mockSettings),
    { getState: () => mockSettings }
  ),
}));
jest.mock('@/shared/stores/runtime/mockPresentationData', () => ({ DEMO_AI_MESSAGES: [] }));
jest.mock('@/shared/stores/profile/aiProviderDirectoryStore', () => ({
  useAiProviderDirectoryStore: { persist: { hasHydrated: () => true } },
}));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: () => null }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/shared/hooks/useScreenInsets', () => ({
  useScreenInsets: () => ({ bottom: 0, dockedTabBarHeight: 0 }),
}));
jest.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => ({ progress: { value: 0 }, height: { value: 0 } }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View' },
  useAnimatedStyle: (style: () => object) => style(),
}));
jest.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/composed/PatternBackground', () => ({ PatternBackground: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'rgb(128, 128, 128)' }));
jest.mock('@/shared/ui/composed/chat/LiquidChatComposer', () => ({
  LiquidChatComposer: 'LiquidChatComposer',
}));
jest.mock('@/shared/ui/composed/chat/useChatSurfacePerfLogger', () => ({
  useChatKeyboardAnimationLogger: jest.fn(),
  useChatSurfacePerfLogger: jest.fn(),
  useComposerHeight: () => [0, jest.fn()],
  useLoggedChatSend: () => jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => {
  const quiet = () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return {
    aiLog: quiet(),
    storeLog: quiet(),
    log: quiet(),
    useLifecycleLogger: jest.fn(),
    useMountLog: jest.fn(),
    redactError: () => 'redacted',
  };
});
jest.mock('@/features/ai/components/ModelChip', () => ({ ModelChip: () => null }));
jest.mock('@/features/ai/components/AiEmptyState', () => ({ AiEmptyState: () => null }));
jest.mock('@/features/ai/components/AiMessageBubble', () => ({ AiMessageBubble: () => null }));
jest.mock('@/features/ai/lib/attachments', () => ({ pickChatImage: jest.fn() }));

let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  mockRoutstr.lineup = lineup;
  mockRoutstr.lastKnownLineup = null;
  mockSettings.mockMode = false;
});

function plusDisabled(): boolean {
  act(() => {
    renderer = TestRenderer.create(<AiChatScreen />);
  });
  return renderer.root.findByType('LiquidChatComposer' as unknown as React.ElementType).props
    .plusDisabled;
}

it('turns the image button off when the wallet can only pay for a text-only model', () => {
  mockFunds = { balanceSats: 1_000 };
  expect(plusDisabled()).toBe(true);
});

it('offers the image button when the wallet can pay for the vision model', () => {
  mockFunds = { balanceSats: 10_000 };
  expect(plusDisabled()).toBe(false);
});

it('reads the saved lineup while this session has none', () => {
  mockFunds = { balanceSats: 10_000 };
  mockRoutstr.lineup = null;
  mockRoutstr.lastKnownLineup = { derivedAt: 1, lineup };
  expect(plusDisabled()).toBe(false);
});

it('keeps an empty session lineup over the saved one', () => {
  mockFunds = { balanceSats: 10_000 };
  mockRoutstr.lineup = emptyLineup();
  mockRoutstr.lastKnownLineup = { derivedAt: 1, lineup };
  expect(plusDisabled()).toBe(true);
});

it('offers no images in mock mode', () => {
  mockFunds = { balanceSats: 10_000 };
  mockSettings.mockMode = true;
  expect(plusDisabled()).toBe(true);
});
