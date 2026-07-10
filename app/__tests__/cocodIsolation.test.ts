/**
 * @jest-environment node
 */

import path from 'node:path';

import { cocodProcessEnv } from '@/codereview/log-doctor/test-dsl/wallet';

describe('cocodProcessEnv', () => {
  it('preserves the runner environment when isolation is not requested', () => {
    const base = { HOME: '/Users/test', PATH: '/bin' };

    expect(cocodProcessEnv(base)).toBe(base);
  });

  it('isolates cocod state without changing unrelated environment values', () => {
    const isolated = cocodProcessEnv({
      HOME: '/Users/test',
      PATH: '/custom/bin',
      SOVRAN_TEST_COCOD_HOME: './.device-artifacts/run-42/cocod',
    });
    const home = path.resolve('./.device-artifacts/run-42/cocod');

    expect(isolated).toMatchObject({
      HOME: home,
      PATH: '/custom/bin',
      COCOD_SOCKET: path.join(home, '.cocod/cocod.sock'),
      COCOD_PID: path.join(home, '.cocod/cocod.pid'),
    });
  });

  it('honours explicit socket and pid paths for an already-running test daemon', () => {
    expect(
      cocodProcessEnv({
        SOVRAN_TEST_COCOD_HOME: '/tmp/sovran-cocod',
        COCOD_SOCKET: '/tmp/custom.sock',
        COCOD_PID: '/tmp/custom.pid',
      })
    ).toMatchObject({
      HOME: '/tmp/sovran-cocod',
      COCOD_SOCKET: '/tmp/custom.sock',
      COCOD_PID: '/tmp/custom.pid',
    });
  });
});
