import { act, create } from 'react-test-renderer';
import { ModeratedDmBubble } from '../features/user/components/ModeratedDmBubble';
import type { ChatBubbleMessage } from '@/shared/ui/composed/chat/types';

jest.mock('@/shared/ui/composed/chat', () => ({
  ChatMessageBubble: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('pre', props),
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('button', props),
}));

const message: ChatBubbleMessage = {
  id: 'message-1',
  content: 'bad words and a payment',
  cashuToken: 'private-token',
  isOwn: false,
  senderId: 'sender',
  timestamp: 1,
};
const props = {
  message,
  isFirstInGroup: true,
  isLastInGroup: true,
  enabled: true,
  words: ['bad'],
  scope: 'account-a:thread',
};

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

it('never mounts text or token affordances until reveal, and resets on recycled messages and accounts', async () => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<ModeratedDmBubble {...props} />);
  });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('private-token');
  expect(JSON.stringify(renderer.toJSON())).not.toContain(message.content);
  await act(async () => {
    renderer.root.findByType('button').props.onPress();
  });
  expect(renderer.root.findByType('pre').props.message.cashuToken).toBe('private-token');
  await act(async () => {
    renderer.update(<ModeratedDmBubble {...props} message={{ ...message, id: 'message-2' }} />);
  });
  expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  await act(async () => {
    renderer.update(<ModeratedDmBubble {...props} scope="account-b:thread" />);
  });
  expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  await act(async () => {
    renderer.update(<ModeratedDmBubble {...props} />);
  });
  expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  await act(async () => {
    renderer.unmount();
  });
});

it('preserves ordinary rendering when disabled or for outgoing messages', async () => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<ModeratedDmBubble {...props} enabled={false} />);
  });
  expect(renderer.root.findAllByType('pre')).toHaveLength(1);
  await act(async () => {
    renderer.update(<ModeratedDmBubble {...props} message={{ ...message, isOwn: true }} />);
  });
  expect(renderer.root.findAllByType('pre')).toHaveLength(1);
  await act(async () => {
    renderer.unmount();
  });
});
