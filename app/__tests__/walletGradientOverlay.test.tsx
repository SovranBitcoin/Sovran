/** @jest-environment node */
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOverlayHeights: number[] = [];
jest.mock('@/shared/ui/composed/BackgroundView', () => ({
  ScrollableGradientOverlay: ({ contentHeight }: { contentHeight: number }) => {
    mockOverlayHeights.push(contentHeight);
    return null;
  },
}));

const { useContentHeightStore, WalletGradientOverlay } =
  require('@/features/wallet/components/WalletGradientOverlay') as typeof import('@/features/wallet/components/WalletGradientOverlay');

it('re-renders only the overlay when the home content height changes', () => {
  let screenRenders = 0;
  let report!: (width: number, height: number) => void;
  function Screen() {
    screenRenders += 1;
    const { store, onContentSizeChange } = useContentHeightStore();
    report = onContentSizeChange;
    return <WalletGradientOverlay store={store} />;
  }
  act(() => {
    TestRenderer.create(<Screen />);
  });
  expect(screenRenders).toBe(1);
  act(() => report(390, 900));
  act(() => report(390, 1240));
  act(() => report(390, 1240));
  act(() => report(390, 1600));
  // Before, each new height re-rendered the whole wallet home.
  expect(screenRenders).toBe(1);
  expect(mockOverlayHeights).toEqual([0, 900, 1240, 1600]);
});
