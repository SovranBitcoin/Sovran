/**
 * A cache server's dot and spoken status. With Fast cache off no server is in
 * use, so none may show a green "Online" however its last probe went.
 */
import { primalHostStatus } from '@/shared/lib/nostr/tierHealth';

it('is off for every server while Fast cache is off', () => {
  expect(primalHostStatus({ tierEnabled: false, hostEnabled: true, health: 'online' })).toBe(
    'disabled'
  );
  expect(primalHostStatus({ tierEnabled: false, hostEnabled: false, health: 'online' })).toBe(
    'disabled'
  );
});

it('is off for a server turned off, and its health otherwise', () => {
  expect(primalHostStatus({ tierEnabled: true, hostEnabled: false, health: 'online' })).toBe(
    'disabled'
  );
  expect(primalHostStatus({ tierEnabled: true, hostEnabled: true, health: 'offline' })).toBe(
    'offline'
  );
  expect(primalHostStatus({ tierEnabled: true, hostEnabled: true, health: undefined })).toBe(
    'checking'
  );
});
