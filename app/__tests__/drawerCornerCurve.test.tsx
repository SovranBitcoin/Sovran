/**
 * @jest-environment node
 *
 * Pins the slide-out drawer's hardware-radius corner curve:
 * - `computeDrawerWidth` always leaves more than `deviceRadius` of the main
 *   scene visible so the full top-left and bottom-left curves stay on screen.
 * - `DrawerSceneOverlay` paints the rounded dim and inset hairline inside the
 *   clipped scene (driven by `useDrawerProgress`), non-interactive so the
 *   transparent stock overlay keeps tap-to-close intact.
 */
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { computeDrawerWidth, DrawerSceneOverlay } from '@/navigation/DrawerSceneOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockProgress = 0;

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: {
      View: (props: Record<string, unknown>) => ReactActual.createElement('AnimatedView', props),
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  };
});

jest.mock('expo-router/drawer', () => ({
  useDrawerProgress: () => ({ get: () => mockProgress }),
}));

const MOCK_BORDER = 'theme-separator-secondary';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => MOCK_BORDER,
}));

jest.mock('@/shared/lib/screenCornerRadius', () => ({
  getScreenCornerRadius: () => 55,
}));

describe('drawer corner curve', () => {
  it('keeps the full hardware corner radius visible on screen across phone widths', () => {
    // 393pt iPhone with 55pt corner radius: 320pt drawer leaves 73pt (> 55pt).
    expect(computeDrawerWidth(393, 55)).toBe(320);
    expect(393 - computeDrawerWidth(393, 55)).toBeGreaterThan(55);

    // 402pt iPhone 16 Pro with 62pt corner radius: leaves 80pt (> 62pt).
    expect(computeDrawerWidth(402, 62)).toBe(322);
    expect(402 - computeDrawerWidth(402, 62)).toBeGreaterThan(62);

    // 440pt Pro Max caps at 340pt drawer (100pt peek).
    expect(computeDrawerWidth(440, 62)).toBe(340);

    // Smaller fallback radius still leaves at least 72pt to tap closed.
    expect(computeDrawerWidth(375, 20)).toBe(303);
  });

  it('paints a non-interactive continuous rounded overlay with an inset hairline driven by drawer progress', () => {
    mockProgress = 0.75;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DrawerSceneOverlay />);
    });
    const overlay = renderer.root.findByProps({ testID: 'drawer-scene-overlay' });
    expect(overlay.props.pointerEvents).toBe('none');
    const flat = StyleSheet.flatten(overlay.props.style);
    expect(flat).toMatchObject({
      backgroundColor: 'rgba(0,0,0,0.66)',
      borderTopLeftRadius: 55,
      borderBottomLeftRadius: 55,
      borderCurve: 'continuous',
      opacity: 0.75,
    });
    expect(String(flat.boxShadow)).toContain(MOCK_BORDER);
    act(() => renderer.unmount());
  });
});
