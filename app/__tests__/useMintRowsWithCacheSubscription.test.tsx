/**
 * @jest-environment node
 *
 * `useMintRowsWithCache` used to depend on the WHOLE `mintMetadataStore.byMintUrl`
 * map, so every `mergeCached` — an audit, a reviews aggregate, a social read or
 * an identity upsert, for ANY mint in the wallet — rebuilt every row and redrew
 * the list. Measured at 954 row renders for 12 distinct rows, 846 wasted.
 *
 * These lock the narrowed subscription: a write to a mint that is NOT on screen
 * must not produce new rows, and a write to one that IS must.
 */

import TestRenderer, { act } from 'react-test-renderer';

import { useMintRowsWithCache, type MintRow } from '@/features/mint/hooks/useMintRowsWithCache';
import type { MintListItem } from 'wallet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ON_SCREEN = 'https://on-screen.example.com';
const ELSEWHERE = 'https://elsewhere.example.com';

type Entry = { displayName?: string; reviewCount?: number };
type State = { byMintUrl: Record<string, Entry> };

// A minimal stand-in for the zustand store that reproduces the one property the
// fix depends on: `mergeCached` spreads the previous map, so entries it did not
// touch keep their identity.
let mockState: State = { byMintUrl: {} };
const mockListeners = new Set<() => void>();

function mergeCached(mintUrl: string, partial: Entry): void {
  const key = mintUrl.replace(/^https?:\/\//i, '');
  mockState = {
    byMintUrl: { ...mockState.byMintUrl, [key]: { ...mockState.byMintUrl[key], ...partial } },
  };
  mockListeners.forEach((listener) => listener());
}

jest.mock('@/shared/stores/global/mintMetadataStore', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return {
    useMintMetadataStore: (
      selector: (s: State) => unknown,
      equals?: (a: never, b: never) => boolean
    ) => {
      const subscribe = (listener: () => void) => {
        mockListeners.add(listener);
        return () => mockListeners.delete(listener);
      };
      // `useShallow` arrives as the selector itself (zustand v5 shape), so just
      // call it; it memoises internally against its own previous result.
      void equals;
      return useSyncExternalStore(
        subscribe,
        () => selector(mockState),
        () => selector(mockState)
      );
    },
  };
});

jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => () => false,
}));

jest.mock('@/features/mint/lib/auditInfo', () => ({ selectMintAudit: () => undefined }));

jest.mock('@/shared/lib/url', () => ({
  normalizeMintUrlKey: (url: string) => url.replace(/^https?:\/\//i, ''),
}));

function item(mintUrl: string): MintListItem {
  return {
    mintUrl,
    displayName: mintUrl,
    balance: 0,
    unit: 'sat',
    status: 'available',
    reason: null,
    isPreferred: false,
  };
}

/** Renders the hook against a fixed base list and records each `rows` identity. */
function mountRows(baseItems: MintListItem[]): {
  seen: MintRow[][];
  unmount: () => void;
} {
  const seen: MintRow[][] = [];
  function Probe() {
    const { rows } = useMintRowsWithCache({ baseItems, itemsStatus: 'loading' });
    if (seen[seen.length - 1] !== rows) seen.push(rows);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe />);
  });
  // Unmounted by the caller: leaving the store subscription open outlives the
  // test and jest reports it as logging after teardown.
  return {
    seen,
    // Block body, not a concise return: `act` returns a thenable and handing
    // that back would make `unmount` a promise-returning void callback.
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

beforeEach(() => {
  mockState = { byMintUrl: {} };
  mockListeners.clear();
});

describe('useMintRowsWithCache subscription', () => {
  it('does not rebuild rows when an off-screen mint is written', () => {
    const { seen, unmount } = mountRows([item(ON_SCREEN)]);
    const before = seen.length;

    act(() => {
      mergeCached(ELSEWHERE, { displayName: 'Somewhere Else', reviewCount: 9 });
    });

    expect(seen.length).toBe(before);
    unmount();
  });

  it('does rebuild rows when an on-screen mint is written', () => {
    const { seen, unmount } = mountRows([item(ON_SCREEN)]);
    const before = seen.length;

    act(() => {
      mergeCached(ON_SCREEN, { displayName: 'On Screen Mint' });
    });

    expect(seen.length).toBeGreaterThan(before);
    expect(seen[seen.length - 1][0].displayName).toBe('On Screen Mint');
    unmount();
  });
});
