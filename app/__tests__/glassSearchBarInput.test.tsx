/**
 * @jest-environment node
 *
 * The search field's text contract on both platforms (`GlassSearchBar`):
 * typing reaches `onChangeText` at once, or trailing-debounced by
 * `debounceMs`; bumping `clearKey` remounts the input with `seedText` and
 * drops a pending emit; a replaced callback receives the next emit; unmount
 * drops a pending emit; the input is a search field with no autocorrect or
 * capitalisation, labelled by its placeholder.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { GlassSearchBar as AndroidBar } from '@/shared/ui/composed/GlassSearchBar/GlassSearchBar.android';
import { GlassSearchBar as IosBar } from '@/shared/ui/composed/GlassSearchBar/GlassSearchBar.ios';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

jest.mock('react-native-web/dist/exports/TextInput', () => ({
  __esModule: true,
  default: mockHost('Input'),
}));
jest.mock('expo-glass-effect', () => ({ GlassView: mockHost('Glass') }));
jest.mock('@/shared/lib/version', () => ({ supportsLiquidGlass: () => false }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? '#000000' : token.map(() => '#000000'),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
}));

type Bar = typeof IosBar;
type Props = React.ComponentProps<Bar>;

let renderer: TestRenderer.ReactTestRenderer;
function mount(Bar: Bar, props: Partial<Props> & Pick<Props, 'onChangeText'>) {
  const element = (over: Partial<Props> = {}) => (
    <Bar testID="search" clearKey={0} placeholder="Search mints" {...props} {...over} />
  );
  act(() => {
    renderer = TestRenderer.create(element());
  });
  return (over: Partial<Props>) => act(() => renderer.update(element(over)));
}
const input = () => renderer.root.findByType('Input' as never);
const type = (text: string) => act(() => input().props.onChangeText(text));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => renderer?.unmount());
  jest.useRealTimers();
});

describe.each([
  ['iOS', IosBar],
  ['Android', AndroidBar],
])('%s', (_platform, Bar) => {
  it('is a search field labelled by its placeholder, with no autocorrect or capitals', () => {
    mount(Bar, { onChangeText: jest.fn(), seedText: 'sat', autoFocus: true });

    expect(input().props).toMatchObject({
      testID: 'search',
      defaultValue: 'sat',
      placeholder: 'Search mints',
      accessibilityLabel: 'Search mints',
      accessibilityRole: 'search',
      keyboardType: 'web-search',
      autoCorrect: false,
      autoCapitalize: 'none',
      autoFocus: true,
    });
  });

  it('without a debounce, passes each change straight on', () => {
    const onChangeText = jest.fn();
    mount(Bar, { onChangeText });

    type('a');
    type('ab');

    expect(onChangeText.mock.calls).toEqual([['a'], ['ab']]);
  });

  it('with a debounce, sends only the last text once the typing stops', () => {
    const onChangeText = jest.fn();
    mount(Bar, { onChangeText, debounceMs: 300 });

    type('a');
    act(() => jest.advanceTimersByTime(200));
    type('ab');
    act(() => jest.advanceTimersByTime(299));
    expect(onChangeText).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));

    expect(onChangeText.mock.calls).toEqual([['ab']]);
  });

  it('a clear remounts the input with the seed text and drops the pending text', () => {
    const onChangeText = jest.fn();
    const update = mount(Bar, { onChangeText, debounceMs: 300 });
    const before = input();

    type('abc');
    update({ clearKey: 1, seedText: 'usd' });
    act(() => jest.advanceTimersByTime(1000));

    expect(onChangeText).not.toHaveBeenCalled();
    expect(input()).not.toBe(before);
    expect(input().props.defaultValue).toBe('usd');
  });

  it('sends a pending text to the callback the bar holds when it fires', () => {
    const first = jest.fn();
    const second = jest.fn();
    const update = mount(Bar, { onChangeText: first, debounceMs: 300 });

    type('abc');
    update({ onChangeText: second });
    act(() => jest.advanceTimersByTime(300));

    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([['abc']]);
  });

  it('drops a pending text on unmount', () => {
    const onChangeText = jest.fn();
    mount(Bar, { onChangeText, debounceMs: 300 });

    type('abc');
    act(() => renderer.unmount());
    act(() => jest.advanceTimersByTime(1000));

    expect(onChangeText).not.toHaveBeenCalled();
  });
});
