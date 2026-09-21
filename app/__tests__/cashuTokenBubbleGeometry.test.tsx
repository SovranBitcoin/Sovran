import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { View as BubbleView } from '@/shared/ui/primitives/View/View';
import { Text as BubbleText } from '@/shared/ui/primitives/Text';
import { act, create } from 'react-test-renderer';
import { ChatMessageBubble } from '@/shared/ui/composed/chat/ChatMessageBubble';
import { CashuTokenBubble } from '@/shared/ui/composed/chat/CashuTokenBubble';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { log } from '@/shared/lib/logger';
import { withAlpha } from '@/shared/lib/color';
import { alpha } from '@/shared/styles/tokens';

// eslint-disable-next-line no-restricted-syntax -- distinct parseable theme fixtures, not UI colors
const mockColors = ['#EEEEEE', '#444444', '#222222', '#888888'] as const;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (names: string | string[]) => {
    const colors: Record<string, string> = {
      foreground: mockColors[0],
      default: mockColors[1],
      'surface-tertiary': mockColors[2],
    };
    return Array.isArray(names)
      ? names.map((name) => colors[name] ?? mockColors[3])
      : (colors[names] ?? mockColors[3]);
  },
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: jest.requireActual<typeof import('react-native')>('react-native-web').View,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: jest.requireActual<typeof import('react-native')>('react-native-web').Text,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: jest.requireActual<typeof import('react-native')>('react-native-web').Pressable,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('assets/icons', () => () => null);
jest.mock('@/shared/lib/version', () => ({ supportsBlur: () => false }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn() },
}));
jest.mock('@/shared/lib/date', () => ({ formatRelative: () => 'now' }));
jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log: logger,
    chatLog: logger,
    paymentLog: logger,
    mintUrlLogFields: () => ({}),
    Log: ({ children }: React.PropsWithChildren) => children,
  };
});
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn() }));
jest.mock('@cashu/cashu-ts', () => ({
  getTokenMetadata: () => ({
    amount: 123456789012345,
    unit: 'sat',
    mint: 'https://a-very-long-mint-host.example.com',
    incompleteProofs: [],
  }),
}));
jest.mock('@/shared/lib/currency', () => ({
  formatAmount: (_value: unknown, options: { displayAs?: string }) =>
    options.displayAs === 'usd' ? '$1,234.56' : '123,456,789,012,345 sats',
}));
jest.mock('liquid-glass-text', () => ({ LiquidGlassText: () => null }));
jest.mock('@/shared/ui/capability', () => ({ useCapabilities: () => ({ liquidGlass: false }) }));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/stores/global/settingsStore', () => ({ useSettingsStore: () => 2 }));

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

// These render tests guard the layout inputs; Jest does not run native Yoga.
describe.each([true, false])('cashu token geometry (isOwn: %s)', (isOwn) => {
  it.each([
    [true, true],
    [true, false],
    [false, false],
    [false, true],
  ])('shares the text fill and group corners (first: %s, last: %s)', async (first, last) => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <View style={{ width: 320, paddingHorizontal: 16 }}>
          <ChatMessageBubble
            message={{
              id: 'geometry-message',
              senderId: 'fixture-peer',
              content: 'For lunch fixture-token',
              cashuToken: 'fixture-token',
              isOwn,
              timestamp: 1,
            }}
            isFirstInGroup={first}
            isLastInGroup={last}
            counterpartyAvatar={<View style={{ width: 32, height: 32 }} />}
          />
        </View>
      );
    });

    expect(jest.mocked(log.warn).mock.calls).toEqual([]);
    const token = renderer.root.findByType(CashuTokenBubble);
    const card = token.findAllByType(BubbleView).find((node) => {
      return StyleSheet.flatten(node.props.style)?.borderWidth === StyleSheet.hairlineWidth;
    });
    expect(card).toBeDefined();
    const cardStyle = StyleSheet.flatten(card!.props.style);
    expect(cardStyle.minWidth).toBeUndefined();
    expect(cardStyle.maxWidth).toBeUndefined();
    expect(card!.props.className).toContain('min-w-0');
    expect(card!.props.className).toContain('self-stretch');
    expect(cardStyle.backgroundColor).toBe(isOwn ? mockColors[1] : mockColors[2]);
    expect(cardStyle.borderColor).toBe(withAlpha(mockColors[0], alpha.subtle));

    const textBubble = renderer.root.findAllByType(View).find((node) => {
      return StyleSheet.flatten(node.props.style)?.paddingHorizontal === 14;
    });
    const textStyle = StyleSheet.flatten(textBubble!.props.style);
    expect(cardStyle.backgroundColor).toBe(textStyle.backgroundColor);
    for (const corner of [
      'borderTopLeftRadius',
      'borderBottomLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
    ] as const) {
      expect(cardStyle[corner]).toBe(textStyle[corner]);
    }
    expect(cardStyle[isOwn ? 'borderTopRightRadius' : 'borderTopLeftRadius']).toBe(first ? 18 : 4);
    expect(cardStyle[isOwn ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']).toBe(
      last ? 18 : 4
    );

    const wrapper = token.findAllByType(BubbleView)[0];
    expect(wrapper.props.className).toContain('self-stretch');
    // The message stack owns the text-to-token distance; the card sets no margin.
    expect(StyleSheet.flatten(wrapper.props.style)?.marginTop).toBeUndefined();
    const messageStack = renderer.root.findAllByProps({
      className: 'min-w-0 gap-2.5 self-stretch',
    })[0];
    expect(messageStack.findByType(CashuTokenBubble)).toBe(token);
    expect(StyleSheet.flatten(wrapper.props.style)?.maxWidth).toBeUndefined();
    const boundedViews = renderer.root.findAllByType(BubbleView).filter((node) => {
      return StyleSheet.flatten(node.props.style)?.maxWidth === '85%';
    });
    expect(boundedViews).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: 'min-w-0 flex-1' }).length).toBeGreaterThan(0);

    const amount = token.findByType(AmountFormatter);
    expect(amount.props.className).toContain('shrink');
    expect(amount.props.className).toContain('flex-wrap');
    const amountText = amount.findByType(Text);
    expect(amountText.props.children).toBe('123,456,789,012,345 sats');
    expect(amountText.props.numberOfLines).toBeUndefined();
    const mintText = token.findAllByType(BubbleText).find((node) => node.props.numberOfLines === 1);
    expect(StyleSheet.flatten(mintText!.props.style).flexShrink).toBe(1);

    const action = token.findAllByType(BubbleText).find((node) => {
      return node.props.children === (isOwn ? 'Cancel' : 'Redeem');
    });
    expect(action).toBeDefined();
    // The pill is visual only: the bubble itself is the single control and
    // names the action in its hint.
    const pill = token.findAllByProps({
      testID: isOwn ? 'cashu-bubble-cancel' : 'cashu-bubble-redeem',
    })[0];
    expect(pill.props.onPress).toBeUndefined();
    const bubble = token.findAllByProps({
      testID: isOwn ? 'cashu-bubble-own' : 'cashu-bubble-incoming',
    })[0];
    expect(bubble.props.accessibilityHint).toBe(
      isOwn ? 'Opens the token to cancel it' : 'Opens the token to redeem it'
    );

    await act(async () => renderer.unmount());
  });

  it('adds no vertical card margins for a token-only message', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <View style={{ width: 320 }}>
          <ChatMessageBubble
            message={{
              id: 'token-only',
              senderId: 'fixture-peer',
              content: 'fixture-token',
              cashuToken: 'fixture-token',
              isOwn,
              timestamp: 1,
            }}
            isFirstInGroup
            isLastInGroup
          />
        </View>
      );
    });
    expect(jest.mocked(log.warn).mock.calls).toEqual([]);
    const token = renderer.root.findByType(CashuTokenBubble);
    const wrapper = token.findAllByType(BubbleView)[0];
    expect(StyleSheet.flatten(wrapper.props.style)?.marginTop).toBeUndefined();
    expect(wrapper.props.className).not.toMatch(/\bm[tby]-/);
    await act(async () => renderer.unmount());
  });
});
