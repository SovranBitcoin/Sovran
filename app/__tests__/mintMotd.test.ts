/**
 * @jest-environment node
 *
 * Mint Info's "Message from the mint" shows only a message the operator wrote:
 * not an empty one, and not Nutshell's shipped placeholder.
 */
import { mintMotd } from '@/features/mint/lib/mintDetailsRows';

it.each([
  [undefined, undefined],
  [42, undefined],
  ['', undefined],
  ['   \n ', undefined],
  ['Message to users', undefined],
  ['  message TO users  ', undefined],
  ['Maintenance Friday 10:00 UTC', 'Maintenance Friday 10:00 UTC'],
  ['  Fees drop next week \n', 'Fees drop next week'],
  ['Message to users: we are moving', 'Message to users: we are moving'],
  [new String(' Boxed message '), 'Boxed message'],
])('reads %p as %p', (motd, expected) => {
  expect(mintMotd(motd)).toBe(expected);
});
