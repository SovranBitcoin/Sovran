/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { AmountHeaderStatus } from '@/features/send/components/AmountHeaderStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('MockView', props, children),
  };
});
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ScreenHeaderAction: (props: Record<string, unknown>) =>
      ReactActual.createElement('MockHeaderAction', props),
  };
});

function render(props: React.ComponentProps<typeof AmountHeaderStatus>) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<AmountHeaderStatus {...props} />);
  });
  const find = (testID: string) => renderer!.root.findAllByProps({ testID })[0]?.props;
  return { lock: find('amount-header-lock'), sendability: find('amount-header-sendability') };
}

describe('AmountHeaderStatus', () => {
  it('shows a closed lock as status only', () => {
    const { lock } = render({
      lock: { locked: true, label: 'Locked to David' },
      canSendOffline: null,
    });
    expect(lock.icon).toBe('mdi:lock-outline');
    expect(lock.accessibilityLabel).toBe('Locked to David');
    // The lock question is asked as the ecash leaves, never from the header.
    expect(lock.onPress).toBeUndefined();
  });

  it('shows an open lock when the ecash will not be locked', () => {
    const { lock } = render({
      lock: { locked: false, label: 'Not locked. Lock to Alice' },
      canSendOffline: true,
    });
    expect(lock.icon).toBe('mdi:lock-open-variant-outline');
  });

  it('has no lock on a payment that is not ecash', () => {
    const { lock, sendability } = render({ canSendOffline: false });
    expect(lock).toBeUndefined();
    expect(sendability.accessibilityLabel).toBe('Network required');
  });

  it('says an unlocked exact amount can leave with no network', () => {
    const { sendability } = render({
      lock: { locked: false, label: 'Not locked' },
      canSendOffline: true,
    });
    expect(sendability.icon).toBe('mdi:airplane');
    expect(sendability.accessibilityLabel).toBe('Offline send available');
  });

  // A lock is made by a swap at the mint. Holding the exact proofs does not
  // help: the send still cannot leave without the network.
  it('says a locked send needs the network even when the proofs match exactly', () => {
    const { sendability } = render({
      lock: { locked: true, label: 'Locked to David' },
      canSendOffline: true,
    });
    expect(sendability.icon).toBe('mdi:wifi');
    expect(sendability.accessibilityLabel).toBe('Network required');
  });
});
