/**
 * @jest-environment node
 *
 * Opening Claim username navigates in the same tick as the tap; the hero
 * overlay is seeded from the source measure once it lands.
 */
const mockNavigate = jest.fn();
const mockMeasure = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: (...args: unknown[]) => mockNavigate(...args), back: jest.fn() },
}));
jest.mock('@/shared/providers/hero-transition/measure', () => ({
  measureInWindowAsync: (...args: unknown[]) => mockMeasure(...args),
  rafAsync: () => Promise.resolve(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  // eslint-disable-next-line no-restricted-syntax -- fixture colours must parse as hex
  useThemeColor: (tokens: string[]) => tokens.map(() => '#000000'),
}));
jest.mock('@/shared/blocks/claim/ClaimUsernameCardFrame', () => ({
  ClaimUsernameCardFrame: () => null,
}));
jest.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));

/* eslint-disable import/first */
import TestRenderer, { act } from 'react-test-renderer';

import {
  HeroTransitionProvider,
  useHeroTransition,
} from '@/shared/providers/hero-transition/HeroTransitionProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hero!: ReturnType<typeof useHeroTransition>;
function Probe() {
  hero = useHeroTransition();
  return null;
}

it('navigates before the source measure resolves', async () => {
  let land!: (rect: null) => void;
  mockMeasure.mockReturnValueOnce(new Promise((done) => (land = done)));
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <HeroTransitionProvider>
        <Probe />
      </HeroTransitionProvider>
    );
  });
  act(() => hero.startClaimUsername());
  expect(mockNavigate).toHaveBeenCalledWith('/claimUsername');
  await act(async () => land(null));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
