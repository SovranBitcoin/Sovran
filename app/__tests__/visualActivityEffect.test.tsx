import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { NavigationContext } from 'expo-router/react-navigation';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';

jest.mock('expo-router/react-navigation', () => ({
  NavigationContext: jest.requireActual('react').createContext(undefined),
}));

it('stops foreground work directly on blur and background, then restarts and releases it', () => {
  let focused = true;
  const listeners = new Map<string, () => void>();
  const appListeners = new Map<string, (state: AppStateStatus) => void>();
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, fn) => {
    appListeners.set(event, fn);
    return { remove: () => appListeners.delete(event) };
  });
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  const navigation = {
    isFocused: () => focused,
    addListener: (event: string, fn: () => void) => {
      listeners.set(event, fn);
      return () => listeners.delete(event);
    },
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    // Only the focus contract is needed by this hook.
    // @ts-expect-error Deliberately minimal navigation provider for lifecycle events.
    <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
  );
  const { unmount } = renderHook(() => useVisualActivityEffect(start), { wrapper });
  expect(start).toHaveBeenCalledTimes(1);
  act(() => {
    focused = false;
    listeners.get('blur')?.();
  });
  expect(stop).toHaveBeenCalledTimes(1);
  act(() => {
    appListeners.get('change')?.('background');
    focused = true;
    listeners.get('focus')?.();
  });
  expect(start).toHaveBeenCalledTimes(1);
  act(() => appListeners.get('change')?.('active'));
  expect(start).toHaveBeenCalledTimes(2);
  unmount();
  expect(stop).toHaveBeenCalledTimes(2);
  expect(listeners.size).toBe(0);
  expect(appListeners.size).toBe(0);
  subscription.mockRestore();
  AppState.currentState = previousState;
});
