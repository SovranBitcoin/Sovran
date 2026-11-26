/**
 * @jest-environment node
 *
 * Which Lightning target a contact is paid at, and whether it is flagged as the
 * app's own npub.cash fallback: a published address (even @npub.cash) is never
 * flagged; a missing one is looked up in the entity cache before falling back.
 */
import { startContactSend } from '@/features/send/lib/startContactSend';
import { resolveProfileLightningTarget } from '@/shared/lib/nostr/profileLightningTarget';

const mockProfiles = new Map<string, Record<string, string>>();
const mockListeners = new Map<string, Set<() => void>>();

jest.mock('@/shared/lib/nostr/dataLayerRegistry', () => ({
  peekNostrDataLayer: () => ({
    cache: {
      profiles: {
        peek: (pubkey: string) => mockProfiles.get(pubkey),
        subscribeKey: (pubkey: string, cb: () => void) => {
          const set = mockListeners.get(pubkey) ?? new Set();
          set.add(cb);
          mockListeners.set(pubkey, set);
          return () => set.delete(cb);
        },
      },
    },
  }),
}));
jest.mock('@/shared/lib/cashu/npc', () => ({
  npcAddressForPubkey: (pubkey: string) => `npub1${pubkey.slice(0, 6)}@npub.cash`,
}));
jest.mock('@/shared/lib/nostr/nutzapProfileDiscovery', () => ({
  prefetchNutzapProfile: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/config/features', () => ({ hasFeature: () => false }));

const PUBKEY = 'ab'.repeat(32);
const startSendEcash = jest.fn(async (_opts: unknown) => undefined);
const machine: Parameters<typeof startContactSend>[0] = { startSendEcash };
const target = (over: Record<string, unknown> = {}) => ({
  pubkey: PUBKEY,
  displayName: 'Alice',
  picture: null,
  nip05: null,
  lud16: null,
  ...over,
});

beforeEach(() => {
  mockProfiles.clear();
  mockListeners.clear();
  startSendEcash.mockClear();
});

describe('startContactSend lightning target', () => {
  it('uses the published address and does not flag it', async () => {
    await startContactSend(machine, target({ lud16: 'alice@example.com' }));
    expect(startSendEcash.mock.calls[0][0]).toMatchObject({ meltTarget: 'alice@example.com' });
    expect(startSendEcash.mock.calls[0][0]).not.toHaveProperty('meltTargetIsNpcFallback');
  });

  it('does not flag an address the person published at npub.cash', async () => {
    await startContactSend(machine, target({ lud16: 'alice@npub.cash' }));
    expect(startSendEcash.mock.calls[0][0]).toMatchObject({ meltTarget: 'alice@npub.cash' });
    expect(startSendEcash.mock.calls[0][0]).not.toHaveProperty('meltTargetIsNpcFallback');
  });

  it('normalises a lightning: prefixed address with a + tag', async () => {
    await startContactSend(machine, target({ lud16: ' lightning:user+tag@domain.com ' }));
    expect(startSendEcash.mock.calls[0][0]).toMatchObject({ meltTarget: 'user+tag@domain.com' });
  });

  it('finds the address in the entity cache when the row carried none', async () => {
    mockProfiles.set(PUBKEY, { lud16: 'cached@example.com' });
    await startContactSend(machine, target());
    expect(startSendEcash.mock.calls[0][0]).toMatchObject({ meltTarget: 'cached@example.com' });
    expect(startSendEcash.mock.calls[0][0]).not.toHaveProperty('meltTargetIsNpcFallback');
  });

  it('falls back to npub.cash, flagged, only when nothing was published', async () => {
    await startContactSend(machine, target());
    expect(startSendEcash.mock.calls[0][0]).toMatchObject({
      meltTarget: `npub1${PUBKEY.slice(0, 6)}@npub.cash`,
      meltTargetIsNpcFallback: true,
    });
  });
});

describe('resolveProfileLightningTarget', () => {
  it('waits for a late kind-0 and returns its address', async () => {
    const pending = resolveProfileLightningTarget(PUBKEY, null, 1000);
    mockProfiles.set(PUBKEY, { lud06: '', lud16: 'late@example.com' });
    mockListeners.get(PUBKEY)?.forEach((cb) => cb());
    await expect(pending).resolves.toBe('late@example.com');
  });

  it('gives up after the bounded wait', async () => {
    await expect(resolveProfileLightningTarget(PUBKEY, null, 20)).resolves.toBeNull();
  });
});
