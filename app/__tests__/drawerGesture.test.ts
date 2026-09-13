import type { NavigationState, PartialState } from 'expo-router/react-navigation';

import { isNestedStackAtRoot } from '@/navigation/drawerGesture';

type State = NavigationState | PartialState<NavigationState>;

const stack = (index: number): PartialState<NavigationState> => ({
  stale: true,
  type: 'stack',
  index,
  routes: [{ name: 'index' }, { name: 'mint-changes' }, { name: 'followers' }],
});

const tabs = (
  index: number,
  ...states: (PartialState<NavigationState> | undefined)[]
): PartialState<NavigationState> => ({
  stale: true,
  type: 'tab',
  index,
  routes: states.map((state, i) => ({ name: `tab-${i}`, state })),
});

describe('isNestedStackAtRoot', () => {
  const cases: { name: string; state?: State; expected: boolean }[] = [
    { name: 'no nested state', expected: true },
    { name: 'first tab at stack root', state: tabs(0, stack(0)), expected: true },
    { name: 'first tab with a pushed screen', state: tabs(0, stack(1)), expected: false },
    {
      name: 'different focused tab with a pushed screen',
      state: tabs(1, stack(0), stack(1)),
      expected: false,
    },
    {
      name: 'unfocused pushed stack does not disable the drawer',
      state: tabs(1, stack(2), stack(0)),
      expected: true,
    },
    {
      name: 'lazy focused tab without stack state',
      state: tabs(1, stack(1), undefined),
      expected: true,
    },
    { name: 'multiple pushed screens', state: tabs(0, stack(2)), expected: false },
    {
      name: 'a pushed stack nested below another stack root',
      state: tabs(0, {
        stale: true,
        type: 'stack',
        index: 0,
        routes: [{ name: 'group', state: stack(1) }],
      }),
      expected: false,
    },
    {
      name: 'partial states without navigator types',
      state: {
        stale: true,
        index: 1,
        routes: [
          { name: 'wallet' },
          {
            name: 'notifications',
            state: { stale: true, index: 1, routes: [{ name: 'index' }, { name: 'mint-changes' }] },
          },
        ],
      },
      expected: false,
    },
    {
      name: 'partial tab state defaults to first tab',
      state: { stale: true, type: 'tab', routes: [{ name: 'notifications', state: stack(1) }] },
      expected: false,
    },
    {
      name: 'partial stack without index focuses its last route',
      state: tabs(0, {
        stale: true,
        type: 'stack',
        routes: [{ name: 'index' }, { name: 'mint-changes' }],
      }),
      expected: false,
    },
    {
      name: 'hydrated native and JS tab state',
      state: {
        stale: false,
        type: 'tab',
        key: 'tabs',
        index: 1,
        routeNames: ['wallet', 'notifications'],
        routes: [
          { key: 'wallet', name: 'wallet' },
          {
            key: 'notifications',
            name: 'notifications',
            state: {
              stale: false,
              type: 'stack',
              key: 'notifications-stack',
              index: 1,
              routeNames: ['index', 'mint-changes'],
              routes: [
                { key: 'index', name: 'index' },
                { key: 'mint-changes', name: 'mint-changes' },
              ],
            },
          },
        ],
      },
      expected: false,
    },
  ];

  it.each(cases)('$name → $expected', ({ state, expected }) => {
    expect(isNestedStackAtRoot({ state })).toBe(expected);
  });

  it('re-enables the drawer after popping back to the focused stack root', () => {
    expect(isNestedStackAtRoot({ state: tabs(1, stack(0), stack(1)) })).toBe(false);
    expect(isNestedStackAtRoot({ state: tabs(1, stack(0), stack(0)) })).toBe(true);
  });
});
