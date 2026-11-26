import { profileSwitchResource } from '@/shared/lib/profile/profileSwitchResource';
import {
  resetProfileNavigation,
  resetProfileNavigationWhenReady,
} from '@/shared/lib/profile/resetProfileNavigation';

it('blocks admission and joins nested calls before revoking retained handles', async () => {
  let complete: () => void = () => {};
  const work = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const target = { nested: { run: () => work } };
  const resource = profileSwitchResource(target, ['nested']);
  const retained = resource.value.nested;
  const running = retained.run();
  const stop = resource.stop();
  let stopped = false;
  void stop.then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(() => retained.run()).toThrow('stopped');
  complete();
  await Promise.all([running, stop]);
  resource.release();
  expect(() => retained.run()).toThrow();
  expect(() => resource.value.nested).toThrow();
});

it('resets to the registered root group without inheriting old routes or params', () => {
  const resetRoot = jest.fn();
  resetProfileNavigation({ isReady: () => true, resetRoot });
  expect(resetRoot).toHaveBeenCalledWith({ index: 0, routes: [{ name: '(drawer)' }] });
  expect(() => resetProfileNavigation({ isReady: () => false, resetRoot })).toThrow('not ready');
  expect(resetRoot).toHaveBeenCalledTimes(1);
});

function fakeNavigation() {
  let ready = false;
  const listeners = new Map<string, () => void>();
  const navigation = {
    isReady: () => ready,
    resetRoot: jest.fn(),
    addListener: (event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    },
  };
  return {
    navigation,
    listeners,
    mountNavigator: () => {
      ready = true;
      listeners.get('state')?.();
    },
  };
}

it('waits for the target navigator to mount before resetting its root', async () => {
  const { navigation, listeners, mountNavigator } = fakeNavigation();
  const reset = resetProfileNavigationWhenReady(navigation, new AbortController().signal);

  expect(navigation.resetRoot).not.toHaveBeenCalled();
  mountNavigator();
  await reset;
  expect(navigation.resetRoot).toHaveBeenCalledWith({ index: 0, routes: [{ name: '(drawer)' }] });
  expect(listeners.size).toBe(0);
});

it('cancels a pending root reset when the fallback suspends the target', async () => {
  const { navigation, listeners, mountNavigator } = fakeNavigation();
  const controller = new AbortController();
  const reset = resetProfileNavigationWhenReady(navigation, controller.signal);

  controller.abort();
  await expect(reset).rejects.toThrow('cancelled');
  mountNavigator();
  expect(navigation.resetRoot).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
