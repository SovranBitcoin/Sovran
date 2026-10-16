/**
 * A focus effect for something the system tears down in the background. It
 * has to run again when the app comes back, which `useFocusEffect` alone does
 * not do for a screen that stayed focused.
 */

/* eslint-disable import/first */

// A screen that is, and stays, focused: the effect runs like an ordinary one.
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useForegroundFocusEffect } from '@/shared/hooks/useForegroundFocusEffect';

let appState = 'active';
const listeners = new Set<() => void>();

function setAppState(state: string) {
  appState = state;
  act(() => {
    for (const listener of listeners) listener();
  });
}

beforeEach(() => {
  appState = 'active';
  listeners.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const call = () => listener('active');
    listeners.add(call);
    const subscription: ReturnType<typeof AppState.addEventListener> = Object.assign(
      Object.create(null),
      { remove: () => void listeners.delete(call) }
    );
    return subscription;
  });
});

afterEach(() => jest.restoreAllMocks());

it('tears down in the background and runs again on return, while the screen stays focused', () => {
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  renderHook(() => useForegroundFocusEffect(start));
  expect(start).toHaveBeenCalledTimes(1);

  setAppState('background');
  expect(stop).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);

  setAppState('active');
  expect(start).toHaveBeenCalledTimes(2);
});

it('leaves it running through the app switcher or a system sheet', () => {
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  renderHook(() => useForegroundFocusEffect(start));

  setAppState('inactive');
  setAppState('active');

  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
});

it('does not start when the screen mounts with the app in the background', () => {
  appState = 'background';
  const start = jest.fn();
  renderHook(() => useForegroundFocusEffect(start));
  expect(start).not.toHaveBeenCalled();

  setAppState('active');
  expect(start).toHaveBeenCalledTimes(1);
});

it('stops listening when the screen goes away', () => {
  const { unmount } = renderHook(() => useForegroundFocusEffect(() => undefined));
  expect(listeners.size).toBe(1);
  unmount();
  expect(listeners.size).toBe(0);
});
