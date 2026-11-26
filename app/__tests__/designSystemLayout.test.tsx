/**
 * @jest-environment node
 */

/**
 * Layout arithmetic of the Design System pages: the fade-stress grid's row,
 * the Screens page's jump index, the prompt preview's close button, and the
 * remembered header height a headerless page must not inherit.
 */

import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { NavigationContext } from 'expo-router/react-navigation';

import {
  FADE_STRESS_COLUMNS,
  FADE_STRESS_GRID_GAP,
  FADE_STRESS_GRID_PADDING,
  FADE_STRESS_PAGE_PADDING,
  FADE_STRESS_TILE_COUNT,
  fadeStressTileSize,
} from '@/features/settings/design-system/fadeRevealStress';
import { activeJumpSection } from '@/features/settings/design-system/jumpIndex';
import {
  SettingsDesignSystemPromptPreviewScreen,
  closePreviewFrame,
} from '@/features/settings/screens/SettingsDesignSystemPromptPreviewScreen';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettledHeaderHeight } from '@/shared/ui/composed/settledHeaderHeight';
import { headerButtonSize } from '@/shared/styles/tokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
jest.mock('@/shared/blocks/CtaScreen', () => ({ CtaView: 'CtaView' }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: 'Probe' }));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: 'ScreenHeaderAction',
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));

describe('fade-stress grid', () => {
  it.each([320, 375, 390, 393, 402, 430, 440, 768, 1024])(
    'fits five tiles to a row at %ipt wide',
    (width) => {
      const tile = fadeStressTileSize(width);
      // The width the tiles get: inside the page padding and the grid's own.
      const inner = width - 2 * FADE_STRESS_PAGE_PADDING - 2 * FADE_STRESS_GRID_PADDING;
      const row = (n: number) => n * tile + (n - 1) * FADE_STRESS_GRID_GAP;
      expect(row(FADE_STRESS_COLUMNS)).toBeLessThanOrEqual(inner);
      expect(row(FADE_STRESS_COLUMNS + 1)).toBeGreaterThan(inner);
      // Floored, never more than a point short of the full row.
      expect(inner - row(FADE_STRESS_COLUMNS)).toBeLessThan(FADE_STRESS_COLUMNS);
    }
  );

  it('fills whole rows', () => {
    expect(FADE_STRESS_TILE_COUNT % FADE_STRESS_COLUMNS).toBe(0);
  });

  it('never goes negative on an impossibly narrow window', () => {
    expect(fadeStressTileSize(10)).toBe(0);
  });
});

describe('Screens page jump index', () => {
  const ORDER = ['options', 'Cashu', 'Lightning', 'profiles', 'wallet'] as const;
  const OFFSETS = { options: 0, Cashu: 400, Lightning: 1200, profiles: 2600, wallet: 3000 };

  it('names the section whose top has reached the scroll offset', () => {
    expect(activeJumpSection(ORDER, OFFSETS, 0, false)).toBe('options');
    expect(activeJumpSection(ORDER, OFFSETS, 399, false)).toBe('Cashu');
    expect(activeJumpSection(ORDER, OFFSETS, 1199.5, false)).toBe('Lightning');
    expect(activeJumpSection(ORDER, OFFSETS, 2000, false)).toBe('Lightning');
  });

  it('gives the end of the scroll to the last section, which cannot reach the top', () => {
    expect(activeJumpSection(ORDER, OFFSETS, 2700, true)).toBe('wallet');
  });

  it('skips sections that are not laid out yet', () => {
    expect(activeJumpSection(ORDER, { options: 0, profiles: 900 }, 1000, false)).toBe('profiles');
    expect(activeJumpSection(ORDER, {}, 1000, false)).toBeUndefined();
  });
});

describe('prompt preview close button', () => {
  it.each([0, 20, 47, 59, 62])('clears a %ipt status bar, and the page starts below it', (top) => {
    const frame = closePreviewFrame(top);
    expect(frame.buttonTop).toBeGreaterThan(top);
    expect(frame.pageTop).toBeGreaterThanOrEqual(frame.buttonTop + headerButtonSize);
  });

  it('pads headerless preview content below the close button and zeroes the child top inset', () => {
    const seen: { top: number; bottom: number }[] = [];
    function Page() {
      seen.push(useSafeAreaInsets());
      return null;
    }
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    const render = (header?: string) => {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <SafeAreaInsetsContext.Provider value={insets}>
            <SettingsDesignSystemPromptPreviewScreen
              entry={{
                kind: 'screen',
                id: 'sample',
                title: 'Sample',
                detail: 'Sample',
                header,
                render: () => <Page />,
              }}
            />
          </SafeAreaInsetsContext.Provider>
        );
      });
      return renderer;
    };

    const headerless = render();
    const padded = headerless.root.findAll(
      (node) => node.props?.style?.paddingTop === closePreviewFrame(47).pageTop
    );
    expect(padded).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ ...insets, top: 0 });
    act(() => {
      headerless.unmount();
    });

    // A page under a navigation title keeps the device insets with no extra wrapper padding.
    const headed = render('Delete account');
    expect(
      headed.root.findAll((node) => node.props?.style?.paddingTop === closePreviewFrame(47).pageTop)
    ).toHaveLength(0);
    expect(seen.at(-1)).toEqual(insets);
    act(() => {
      headed.unmount();
    });
  });
});

describe('remembered header height', () => {
  const originalOS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  });

  const navigation = {
    getState: () => ({ routeNames: ['design-system', 'design-system-prompt'] }),
  };

  function mount(initial: number) {
    const seen: number[] = [];
    function Probe({ height }: { height: number }) {
      seen.push(useSettledHeaderHeight(height));
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    const tree = (height: number) => (
      <NavigationContext.Provider value={navigation as never}>
        <Probe height={height} />
      </NavigationContext.Provider>
    );
    act(() => {
      renderer = TestRenderer.create(tree(initial));
    });
    return {
      seen,
      settle: (height: number) => act(() => renderer.update(tree(height))),
      unmount: () => act(() => renderer.unmount()),
    };
  }

  it('starts a headed page at the height its stack settled to', () => {
    const first = mount(83);
    first.settle(93);
    first.unmount();

    const next = mount(83);
    expect(next.seen[0]).toBe(93);
    next.unmount();
  });

  it('leaves a page without a header at 0 instead of the stack’s height', () => {
    const headerless = mount(0);
    expect(headerless.seen).toEqual(expect.not.arrayContaining([93]));
    expect(headerless.seen.at(-1)).toBe(0);
    headerless.unmount();
  });
});
