/**
 * @jest-environment node
 */

import {
  MODAL_PROFILE_FLOW,
  USER_PROFILE_FLOW,
  buildModalProfileHref,
  buildProfileHref,
  resolveProfileFlowGroup,
} from '@/shared/lib/nav/profileRoutes';

jest.mock('expo-router', () => ({
  useSegments: jest.fn(() => []),
}));

describe('profile route helpers', () => {
  it('defaults to user-flow outside profile-flow', () => {
    expect(resolveProfileFlowGroup(['(drawer)', '(tabs)', 'contacts'])).toBe(USER_PROFILE_FLOW);
    expect(buildProfileHref('profile', { pubkey: 'a'.repeat(64) })).toEqual({
      pathname: '/(user-flow)/profile',
      params: { pubkey: 'a'.repeat(64) },
    });
  });

  it('keeps profile-internal routes inside profile-flow when active', () => {
    expect(resolveProfileFlowGroup(['(profile-flow)', 'profile'])).toBe(MODAL_PROFILE_FLOW);
    expect(
      buildProfileHref('share', { type: 'npub', data: 'npub1abc' }, MODAL_PROFILE_FLOW)
    ).toEqual({
      pathname: '/(profile-flow)/share',
      params: { type: 'npub', data: 'npub1abc' },
    });
    expect(
      buildProfileHref('userMessages', { pubkey: 'b'.repeat(64) }, MODAL_PROFILE_FLOW)
    ).toEqual({
      pathname: '/(profile-flow)/userMessages',
      params: { pubkey: 'b'.repeat(64) },
    });
  });

  it('builds modal-origin profile hrefs for scanner and modal contexts', () => {
    expect(buildModalProfileHref({ npub: 'npub1abc' })).toEqual({
      pathname: '/(profile-flow)/profile',
      params: { npub: 'npub1abc' },
    });
  });
});
