import { useSegments } from 'expo-router';

export const USER_PROFILE_FLOW = '(user-flow)';
export const MODAL_PROFILE_FLOW = '(profile-flow)';

export type ProfileFlowGroup = typeof USER_PROFILE_FLOW | typeof MODAL_PROFILE_FLOW;

export type ProfileRouteName =
  | 'profile'
  | 'share'
  | 'userMessages'
  | 'thread'
  | 'whitenoiseSetup'
  | 'whitenoiseDM'
  | 'bitchatDM'
  | 'bitchatNetwork';

type ProfileRouteParamValue = string | number | (string | number)[] | null | undefined;
type ProfileRouteParams = Record<string, ProfileRouteParamValue>;

export type ProfileHref<Route extends ProfileRouteName = ProfileRouteName> = {
  pathname: `/${ProfileFlowGroup}/${Route}`;
  params?: ProfileRouteParams;
};

export function resolveProfileFlowGroup(
  segments: readonly string[] | null | undefined
): ProfileFlowGroup {
  return segments?.includes(MODAL_PROFILE_FLOW) ? MODAL_PROFILE_FLOW : USER_PROFILE_FLOW;
}

export function useActiveProfileFlowGroup(): ProfileFlowGroup {
  return resolveProfileFlowGroup(useSegments());
}

export function buildProfileHref<Route extends ProfileRouteName>(
  route: Route,
  params?: ProfileRouteParams,
  flowGroup: ProfileFlowGroup = USER_PROFILE_FLOW
): ProfileHref<Route> {
  return {
    pathname: `/${flowGroup}/${route}`,
    ...(params ? { params } : {}),
  };
}

export function buildModalProfileHref(params: ProfileRouteParams): {
  pathname: '/(profile-flow)/profile';
  params: ProfileRouteParams;
} {
  return {
    pathname: '/(profile-flow)/profile',
    params,
  };
}
