/**
 * @jest-environment node
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { zIndex } from '@/shared/styles/tokens';
import { SearchOverlay } from '@/shared/ui/composed/search/SearchOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockIsSearching = false;

jest.mock('@/shared/ui/composed/SearchLayout', () => ({
  useSearchContext: () => ({ isSearching: mockIsSearching }),
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => 'surface-color',
}));

jest.mock('@/shared/ui/composed/search/UnifiedSearch', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    UnifiedSearch: ({ recentContext }: { recentContext: string }) =>
      ReactActual.createElement(RNView, { testID: `unified-search-${recentContext}` }),
  };
});

let consoleErrorSpy: jest.SpyInstance;

describe('SearchOverlay', () => {
  beforeEach(() => {
    mockIsSearching = false;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not render while header search is closed', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<SearchOverlay recentContext="feed" />);
    });

    expect(renderer!.toJSON()).toBeNull();

    act(() => {
      renderer!.unmount();
    });
  });

  it('renders an opaque full overlay while header search is open', () => {
    mockIsSearching = true;
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<SearchOverlay recentContext="wallet" topInset={44} />);
    });

    const overlay = renderer!.root.findByProps({ testID: 'search-overlay-wallet' });
    const unifiedSearch = renderer!.root.findByProps({ testID: 'unified-search-wallet' });
    const style = StyleSheet.flatten(overlay.props.style);

    expect(unifiedSearch).toBeTruthy();
    expect(style).toEqual(
      expect.objectContaining({
        backgroundColor: 'surface-color',
        bottom: 0,
        left: 0,
        paddingTop: 44,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: zIndex.overlay,
      })
    );

    act(() => {
      renderer!.unmount();
    });
  });
});
