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
jest.mock('@/features/payments/lib/dmEcashRecovery', () => ({
  ...jest.requireActual('@/features/payments/lib/dmEcashRecovery'),
  reconcileParkedMessageEcash: (owner: string, stillCurrent: () => boolean) =>
    mockReconcile(owner, stillCurrent),
}));

// The row has its own look; here it is a plain host view so the test reads
// what this section decides: which rows, what words, where a tap goes.
jest.mock('@/features/payments/components/MessageEcashRow', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    MessageEcashRow: (props: {
      testID: string;
      title: string;
      detail: string;
      amount: number;
      showPicture: boolean;
      onPress: () => void;
    }) =>
      createElement(
        'View',
        { testID: props.testID, onPress: props.onPress, showPicture: props.showPicture },
        createElement('Text', null, props.title),
        createElement('Text', null, props.detail),
        createElement('Text', null, `+${props.amount}`)
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
jest.mock('@/shared/ui/composed/SectionHeading', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    SectionHeading: (props: { label: string }) => createElement('Text', null, props.label),
  };
});

const store = () => useNutDropRedeemQueueStore.getState();

function park(
  tokenHash: string,
  status: 'untrusted-mint' | 'failed',
  mintUrl = 'https://mint.example',
  amount = 21
) {
  store().enqueue(tokenHash, {
    token: `cashuB${tokenHash}`,
    mintUrl,
    amount,
    unit: 'sat',
    source: 'nostr',
  });
  store().markStatus(tokenHash, status, 'parked');
}

beforeEach(() => {
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
  mockNavigate.mockReset();
  mockReconcile.mockClear();
});

describe('message ecash waiting to be received', () => {
  it('renders nothing, and checks nothing, when no token is held', () => {
    render(<MessageEcashToReview />);
    expect(screen.queryByTestId('message-ecash-to-review')).toBeNull();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('shows one row per mint with the total held there', () => {
    park('aaaa000001', 'untrusted-mint', 'https://mint.example', 21);
    park('aaaa000002', 'untrusted-mint', 'https://mint.example', 100);
    park('bbbb000001', 'failed', 'https://other.example', 5);
    render(<MessageEcashToReview />);
    expect(screen.getByText('To receive')).toBeTruthy();
    expect(screen.getAllByText('Receive all')).toHaveLength(2);
    expect(screen.getByText('mint.example')).toBeTruthy();
    expect(screen.getByText('+121')).toBeTruthy();
    expect(screen.getByText('other.example')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
  });

  it("opens the mint's page, and keeps an unknown mint's picture unfetched", () => {
    park('aaaa000001', 'untrusted-mint');
    render(<MessageEcashToReview />);
    const row = screen.getByTestId('message-ecash-mint-https-mint-example-sat');
    expect(row.props.showPicture).toBe(false);
    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(receive-flow)/messageEcash',
      params: { mintUrl: 'https://mint.example', unit: 'sat' },
    });
  });

  it('re-checks held tokens whenever the home regains focus', () => {
    park('aaaa000001', 'failed');
    render(<MessageEcashToReview />);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});
