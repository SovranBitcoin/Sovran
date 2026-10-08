import { fireEvent, render, screen } from '@testing-library/react-native';

import { MessageEcashToReview } from '@/features/payments/components/MessageEcashToReview';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const mockNavigate = jest.fn();
const mockReconcile = jest.fn(async (_owner: string, _stillCurrent: () => boolean) => false);

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'a'.repeat(64) } }),
}));
jest.mock('@/features/nearPay/lib/nutDropAutoRedeem', () => ({
  drainNutDropRedeemQueue: jest.fn(async () => undefined),
}));
jest.mock('@/shared/lib/cashu/utils', () => ({
  buildReceiveHistoryEntry: (token: string, unit: string) => ({ token, unit }),
}));
jest.mock('@/features/payments/lib/dmEcashRecovery', () => ({
  ...jest.requireActual('@/features/payments/lib/dmEcashRecovery'),
  reconcileParkedMessageEcash: (owner: string, stillCurrent: () => boolean) =>
    mockReconcile(owner, stillCurrent),
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: 'AmountFormatter' }));

// The row and its frame have their own suites; here they are plain host
// views so the test reads what this section decides: which rows, what words,
// where a tap goes.
jest.mock('@/shared/ui/composed/ListRow', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    ListRow: (props: { testID: string; title: string; subtitle: string; onPress: () => void }) =>
      createElement(
        'View',
        { testID: props.testID, onPress: props.onPress },
        createElement('Text', null, props.title),
        createElement('Text', null, props.subtitle)
      ),
  };
});
jest.mock('@/shared/ui/composed/Surface', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Surface: (props: { children: import('react').ReactNode; testID: string }) =>
      createElement('View', { testID: props.testID }, props.children),
    useSurfaceInset: () => 0,
  };
});
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'rgb(128,128,128)') : 'rgb(128,128,128)',
}));

const store = () => useNutDropRedeemQueueStore.getState();

function park(status: 'untrusted-mint' | 'failed') {
  store().enqueue('abcdef0123', {
    token: 'cashuBtoken',
    mintUrl: 'https://mint.example',
    amount: 21,
    unit: 'sat',
    source: 'nostr',
  });
  store().markStatus('abcdef0123', status, 'parked');
}

beforeEach(() => {
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
  mockNavigate.mockReset();
  mockReconcile.mockClear();
});

describe('message ecash that needs review', () => {
  it('renders nothing, and checks nothing, when no token is parked', () => {
    render(<MessageEcashToReview />);
    expect(screen.queryByTestId('message-ecash-to-review')).toBeNull();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('names the untrusted mint and opens the token in the receive screen', () => {
    park('untrusted-mint');
    render(<MessageEcashToReview />);
    expect(screen.getByText('Needs your review')).toBeTruthy();
    expect(screen.getByText(/Unknown mint · mint\.example/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('message-ecash-review-abcdef01'));
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(receive-flow)/receiveToken',
      params: { receiveHistoryEntry: JSON.stringify({ token: 'cashuBtoken', unit: 'sat' }) },
    });
  });

  it('re-checks parked tokens whenever the home regains focus', () => {
    park('failed');
    render(<MessageEcashToReview />);
    expect(screen.getByText(/Not added · mint\.example/)).toBeTruthy();
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});
