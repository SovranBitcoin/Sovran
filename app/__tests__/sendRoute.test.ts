import { sendRouteOf } from '@/shared/stores/runtime/sendRoute';

const nearby = {
  peerID: 'peer-1',
  nickname: 'Bob',
  hasDirectLink: true,
  lastSeen: 0,
};
const contact = { pubkey: 'a'.repeat(64), delivery: 'nip17' as const };

describe('sendRouteOf', () => {
  it('hands the token over on screen when no recipient was chosen', () => {
    expect(sendRouteOf({ nearby: null, contact: null })).toEqual({ kind: 'handOff' });
  });

  it('messages a contact the send was addressed to', () => {
    expect(sendRouteOf({ nearby: null, contact })).toEqual({ kind: 'contact', target: contact });
  });

  it('sends to a nearby recipient over the mesh', () => {
    expect(sendRouteOf({ nearby, contact: null })).toEqual({ kind: 'nearby', recipient: nearby });
  });

  it('prefers the nearby recipient when both are somehow set', () => {
    expect(sendRouteOf({ nearby, contact }).kind).toBe('nearby');
  });
});
