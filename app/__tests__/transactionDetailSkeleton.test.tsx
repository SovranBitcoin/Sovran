/**
 * @jest-environment node
 *
 * A detail screen whose entry has not resolved draws the detail frame (same
 * `Screen`, header, mint card and timeline placeholders), not a centred
 * spinner that the real content then replaces wholesale.
 */
const mockScreen = jest.fn();
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: (props: { children: React.ReactNode }) => {
    mockScreen(props);
    return props.children;
  },
}));
jest.mock('@/shared/ui/composed/Surface', () => ({
  Surface: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: 'Skeleton' }));

/* eslint-disable import/first */
import TestRenderer, { act } from 'react-test-renderer';

import { TransactionDetailSkeleton } from '@/features/transactions/components/detail/TransactionDetailSkeleton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the screen frame of the detail it stands in for and announces loading', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <TransactionDetailSkeleton screenName="LightningSendScreen" label="Loading transaction" />
    );
  });
  expect(mockScreen).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'LightningSendScreen', contentPadding: 0, deferContent: false })
  );
  const body = tree.root.findByProps({ testID: 'transaction-detail-skeleton' });
  expect(body.props).toMatchObject({
    accessibilityRole: 'progressbar',
    accessibilityLabel: 'Loading transaction',
    accessibilityState: { busy: true },
  });
  expect(tree.root.findAllByType('Skeleton' as never).length).toBeGreaterThan(5);
  act(() => tree.unmount());
});
