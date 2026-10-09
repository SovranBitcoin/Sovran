import { profileSwitchResource } from '@/shared/lib/profile/profileSwitchResource';
import { resetProfileNavigation } from '@/shared/lib/profile/resetProfileNavigation';

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
