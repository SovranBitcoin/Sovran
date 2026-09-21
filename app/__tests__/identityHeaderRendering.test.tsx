import TestRenderer, { act } from 'react-test-renderer';
import { IdentityHeader, useIdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { headerButtonSize } from '@/shared/styles/tokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockReactions = new Set<() => void>();
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: { View: 'View' },
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(initial);
      return React.useMemo(
        () => ({
          get: () => ref.current,
          set: (next: unknown) => {
            ref.current = next;
          },
        }),
        []
      );
    },
    useAnimatedReaction: (prepare: () => unknown, react: (next: unknown) => void) => {
      React.useEffect(() => {
        const run = () => react(prepare());
        mockReactions.add(run);
        return () => mockReactions.delete(run);
      }, [prepare, react]);
    },
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: (handler: unknown) => handler,
    withTiming: (value: unknown) => value,
    runOnJS: (fn: unknown) => fn,
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: 'MintIcon' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: () => null }));

it('does not rerender the owning page during identity handoff or reversal', () => {
  let renders = 0;
  let morph!: ReturnType<typeof useIdentityHeader>;
  function Page() {
    renders += 1;
    morph = useIdentityHeader({ identity: { name: 'Alex', seed: 'alex' } });
    return morph.probe;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Page />);
  });
  const initial = renders;
  for (const y of [0, 77, 100, 55, 0, 80]) {
    act(() => {
      morph.scrollY.set(y);
      [...mockReactions].forEach((run) => run());
    });
  }
  expect(renders - initial).toBe(0);
  act(() => tree.unmount());
});

it('draws a mint identity with MintIcon, so a missing icon is the mint placeholder', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<IdentityHeader kind="mint" name="Mint" seed="https://mint" />);
  });
  expect(tree.root.findAllByType('MintIcon' as never)).toHaveLength(1);
  expect(tree.root.findAllByType('Avatar' as never)).toHaveLength(0);
  act(() => tree.unmount());
});

it('draws a person with the seeded Avatar', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<IdentityHeader name="Alex" seed="alex" />);
  });
  expect(tree.root.findAllByType('Avatar' as never)).toHaveLength(1);
  expect(tree.root.findAllByType('MintIcon' as never)).toHaveLength(0);
  act(() => tree.unmount());
});

it('collapses to an icon the size of a header button, with the name in the band below', () => {
  let morph!: ReturnType<typeof useIdentityHeader>;
  function Page() {
    morph = useIdentityHeader({ identity: { name: 'Alex', seed: 'alex' }, title: 'Details' });
    return null;
  }
  let page!: TestRenderer.ReactTestRenderer;
  act(() => {
    page = TestRenderer.create(<Page />);
  });

  let bar!: TestRenderer.ReactTestRenderer;
  act(() => {
    bar = TestRenderer.create(morph.headerTitle());
  });
  // Same diameter as every headerLeft/headerRight control, so the collapsed
  // bar reads as one row of equal circles.
  expect(bar.root.findByType('Avatar' as never).props.size).toBe(headerButtonSize);
  expect((morph.headerBand as { props: { name: string } }).props.name).toBe('Alex');

  act(() => bar.unmount());
  act(() => page.unmount());
});

it('has no name band on a screen with no identity', () => {
  let morph!: ReturnType<typeof useIdentityHeader>;
  function Page() {
    morph = useIdentityHeader({ title: 'Details' });
    return null;
  }
  let page!: TestRenderer.ReactTestRenderer;
  act(() => {
    page = TestRenderer.create(<Page />);
  });
  expect(morph.headerBand).toBeNull();
  act(() => page.unmount());
});
