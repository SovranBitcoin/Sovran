/**
 * @jest-environment node
 *
 * `useNostrProfileMetadataMany` depended on the caller's `pubkeys` ARRAY, and
 * ~30 surfaces build that set inline (ContactsScreen unions five sources in its
 * render body). A fresh array with identical contents therefore rebuilt the
 * metadata Map on most renders, and that identity change redrew each consumer's
 * list — measured on Contacts as 2177 row renders for 19 distinct rows, 1443
 * wasted.
 *
 * These lock the contract: same contents → same Map; changed contents → new Map.
 */

import TestRenderer, { act } from 'react-test-renderer';

import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

// A stable records map, so the only thing that can move the result is the
// pubkey list — which is exactly what this test is about.
const mockRecords = new Map([[PK_A, { pubkey: PK_A, name: 'Alice' }]]);

jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useProfileRecordsMany: () => mockRecords,
  useCachedNostrProfile: () => undefined,
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (s: { mockMode: boolean }) => unknown) =>
    selector({ mockMode: false }),
}));

jest.mock('@/shared/stores/runtime/mockDataStore', () => ({
  getMockProfileMetadata: () => undefined,
}));
jest.mock('@/shared/stores/profile/ownProfileMetadataStore', () => ({
  useOwnProfileMetadataStore: () => undefined,
}));
jest.mock('@/shared/stores/global/profileStore', () => ({ useProfileStore: () => undefined }));
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({ fetchProfilesViaFacade: jest.fn() }));

/** Renders with `pubkeys` rebuilt as a FRESH array each time, as callers do. */
function renderWithLists(lists: string[][]): ReadonlyMap<string, NostrProfileMetadata>[] {
  const seen: ReadonlyMap<string, NostrProfileMetadata>[] = [];
  function Probe({ list }: { list: string[] }) {
    const { metadata } = useNostrProfileMetadataMany(list);
    if (seen[seen.length - 1] !== metadata) seen.push(metadata);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe list={[...lists[0]]} />);
  });
  for (const list of lists.slice(1)) {
    act(() => {
      renderer.update(<Probe list={[...list]} />);
    });
  }
  act(() => {
    renderer.unmount();
  });
  return seen;
}

describe('useNostrProfileMetadataMany identity', () => {
  it('keeps one Map across renders that pass an equal list in a new array', () => {
    const seen = renderWithLists([
      [PK_A, PK_B],
      [PK_A, PK_B],
      [PK_A, PK_B],
    ]);
    expect(seen).toHaveLength(1);
  });

  it('produces a new Map when the list actually changes', () => {
    const seen = renderWithLists([[PK_A], [PK_A, PK_B]]);
    expect(seen.length).toBeGreaterThan(1);
  });
});
