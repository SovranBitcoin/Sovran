/**
 * @jest-environment node
 *
 * Which badge the avatar's corner disc carries.
 *
 * There is room for one, so a lock replaces the direction arrow rather than
 * crowding it: direction is already in the amount's colour and sign, while
 * "only they can spend this" has nowhere else to live.
 */

import { headerBadgeIcon, headerBadgeLabel } from '../components/detail/headerBadge';

describe('transaction header badge', () => {
  it('shows direction by default, both ways', () => {
    expect(headerBadgeIcon('direction', true)).toBe('fluent:arrow-upload-16-filled');
    expect(headerBadgeIcon('direction', false)).toBe('fluent:arrow-download-16-filled');
  });

  it('shows a lock instead when the transaction is locked', () => {
    expect(headerBadgeIcon('lock', true)).toBe('mdi:lock-outline');
    expect(headerBadgeIcon('lock', false)).toBe('mdi:lock-outline');
  });

  it('says the badge out loud, since a 16px glyph cannot', () => {
    expect(headerBadgeLabel('lock', true)).toBe('Locked to the recipient');
    expect(headerBadgeLabel('direction', true)).toBe('Outgoing');
    expect(headerBadgeLabel('direction', false)).toBe('Incoming');
  });
});
