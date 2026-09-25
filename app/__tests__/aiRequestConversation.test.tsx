/**
 * @jest-environment node
 *
 * The AI-request detail screen shows what the money bought — the prompt we
 * sent and the answer we paid for — and tapping it opens that conversation.
 *
 * The load-bearing rule is the silence: AI history is local and erasable, so a
 * request whose conversation has been cleared must render NOTHING. A card that
 * taps into a blank chat is worse than no card at all.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AiConversationSection } from '@/features/transactions/components/detail/AiConversationSection';
import {
  aiConversationPreview,
  type PreviewableMessage,
} from '@/features/transactions/lib/aiConversationPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) => (props: Record<string, unknown>) => {
  const R = jest.requireActual<typeof import('react')>('react');
  return R.createElement(name, props, props.children as React.ReactNode);
};

interface Session {
  id: string;
  title: string;
  messages: PreviewableMessage[];
}

let mockSessions: Session[] = [];
const mockOpenAiSession = jest.fn();

jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: (selector: (state: { sessions: Session[] }) => unknown) =>
    selector({ sessions: mockSessions }),
}));
jest.mock('@/features/transactions/lib/openAiSession', () => ({
  openAiSession: (...args: unknown[]) => mockOpenAiSession(...args),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'c' }));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  Log: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/GradientCard', () => ({ GradientCard: stub('GradientCard') }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: stub('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: stub('Text') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: stub('HStack') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: stub('View') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));

const user = (id: string, content: string): PreviewableMessage => ({
  id,
  role: 'user',
  content,
  parentId: null,
});
const assistant = (id: string, content: string, parentId: string): PreviewableMessage => ({
  id,
  role: 'assistant',
  content,
  parentId,
});

const EXCHANGE: PreviewableMessage[] = [
  user('u1', 'What is a Cashu proof?'),
  assistant('a1', 'A blinded signature you can spend.', 'u1'),
];

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

const card = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByProps({ testID: 'ai-request-conversation' })[0];

beforeEach(() => {
  mockSessions = [{ id: 's1', title: 'Cashu questions', messages: [...EXCHANGE] }];
  mockOpenAiSession.mockClear();
});

describe('aiConversationPreview', () => {
  it('pairs the paid-for answer with the prompt its parent link names', () => {
    expect(aiConversationPreview(EXCHANGE, 'a1')).toEqual({
      prompt: 'What is a Cashu proof?',
      reply: 'A blinded signature you can spend.',
    });
  });

  it('falls back to the nearest earlier user turn when the tree link predates the field', () => {
    const legacy: PreviewableMessage[] = [
      { id: 'u1', role: 'user', content: 'Older prompt' },
      { id: 'a1', role: 'assistant', content: 'Older answer' },
    ];
    expect(aiConversationPreview(legacy, 'a1')).toEqual({
      prompt: 'Older prompt',
      reply: 'Older answer',
    });
  });

  it('still previews the last prompt when the paid-for answer itself is gone', () => {
    expect(aiConversationPreview(EXCHANGE, 'deleted')).toEqual({
      prompt: 'What is a Cashu proof?',
      reply: '',
    });
  });

  it('gives up on an emptied conversation', () => {
    expect(aiConversationPreview([], 'a1')).toBeNull();
  });
});

describe('AiConversationSection', () => {
  it('previews the exchange and opens it on tap', () => {
    const r = render(
      <AiConversationSection group={{ sessionId: 's1', messageId: 'a1', model: 'claude-opus-5' }} />
    );

    const texts = r.root.findAllByType('Text' as never).map((n) => n.props.children);
    expect(texts).toContain('What is a Cashu proof?');
    expect(texts).toContain('A blinded signature you can spend.');
    // The model that answered rides the pill, the way the zap card's pill
    // carries the zap.
    expect(texts).toContain('claude-opus-5');

    const pressable = card(r);
    expect(pressable.props.accessibilityLabel).toContain('Cashu questions');
    act(() => {
      (pressable.props.onPress as () => void)();
    });
    expect(mockOpenAiSession).toHaveBeenCalledWith('s1');
  });

  it('renders nothing when the conversation was cleared', () => {
    mockSessions = [];
    const r = render(
      <AiConversationSection group={{ sessionId: 's1', messageId: 'a1', model: 'm' }} />
    );
    expect(r.root.findAllByProps({ testID: 'ai-request-conversation' })).toHaveLength(0);
    expect(r.toJSON()).toBeNull();
  });

  it('renders nothing when the payment never named a session', () => {
    const r = render(<AiConversationSection group={{ messageId: 'a1', model: 'm' }} />);
    expect(r.toJSON()).toBeNull();
  });

  it('renders nothing when the session survives but its messages do not', () => {
    mockSessions = [{ id: 's1', title: 'Cashu questions', messages: [] }];
    const r = render(
      <AiConversationSection group={{ sessionId: 's1', messageId: 'a1', model: 'm' }} />
    );
    expect(r.toJSON()).toBeNull();
  });
});
