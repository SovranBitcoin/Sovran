import { useDmEchoStore, type DmEchoMessage } from '@/shared/stores/runtime/dmEchoStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const echo = (id: string, overrides: Partial<DmEchoMessage> = {}): DmEchoMessage => ({
  id,
  content: `body-${id}`,
  isOwn: true,
  created_at: 1_700_000_000,
  pubkey: 'own-pubkey',
  ...overrides,
});

describe('dmEchoStore', () => {
  beforeEach(() => {
    useDmEchoStore.setState({ byThread: {} });
  });

  it('appends per protocol thread and dedups by self-wrap id', () => {
    const { append, getForThread } = useDmEchoStore.getState();
    append('nip17', 'own-pubkey', 'peer-a', echo('wrap-1'));
    append('nip17', 'own-pubkey', 'peer-a', echo('wrap-1'));
    append('nip17', 'own-pubkey', 'peer-b', echo('wrap-2'));
    expect(getForThread('nip17', 'own-pubkey', 'peer-a')).toHaveLength(1);
    expect(getForThread('nip17', 'own-pubkey', 'peer-b')).toHaveLength(1);
  });

  it("never exposes a NIP-17 echo in the same peer's NIP-04 thread", () => {
    const { append, getForThread } = useDmEchoStore.getState();
    append('nip17', 'own-pubkey', 'peer-a', echo('wrap-1'));
    expect(getForThread('nip04', 'own-pubkey', 'peer-a')).toEqual([]);
  });

  it("never exposes one profile's bearer-token echo to another profile", () => {
    const { append, getForThread } = useDmEchoStore.getState();
    append('nip17', 'profile-a', 'peer-a', echo('wrap-1', { pubkey: 'profile-a' }));
    expect(getForThread('nip17', 'profile-b', 'peer-a')).toEqual([]);
    expect(getForThread('nip17', 'profile-a', 'peer-a')).toHaveLength(1);
  });

  it('caps echoes per profile thread, dropping the oldest', () => {
    const { append, getForThread } = useDmEchoStore.getState();
    for (let index = 0; index < 25; index++)
      append('nip17', 'own-pubkey', 'peer-a', echo(`wrap-${index}`));
    const kept = getForThread('nip17', 'own-pubkey', 'peer-a');
    expect(kept).toHaveLength(20);
    expect(kept[0]!.id).toBe('wrap-5');
    expect(kept.at(-1)!.id).toBe('wrap-24');
  });

  it('is seeded into the thread the payment flow navigates to', () => {
    // Pin both sides of the delivery-to-thread seam so it is not silently
    // removed or stripped of its active-profile scope.
    const screen = readFileSync(
      resolve(__dirname, '../features/user/screens/UserMessagesScreen.tsx'),
      'utf8'
    );
    expect(screen).toContain(
      'useDmEchoStore.getState().getForThread(protocol, nostrKeys.pubkey, pubkey)'
    );
    const colada = readFileSync(
      resolve(__dirname, '../features/send/providers/Colada.tsx'),
      'utf8'
    );
    expect(colada).toContain(
      "useDmEchoStore.getState().append('nip17', ownPubkey, recipientPubkey"
    );
  });
});
