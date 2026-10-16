import { spawn } from 'node:child_process';
import { expect, test } from 'bun:test';
import { createScreenWatch, pictureName, recordSimulator } from './evidence';

test("a step's picture is named by its place in the story and what it does", () => {
  expect(pictureName(1, 'agree to the Terms')).toBe('02-agree-to-the-terms');
});

/** A screen whose picture changes at the given times. */
function screenThatChangesAt(times: number[]) {
  let clock = 0;
  let told = 0;
  const watch = createScreenWatch({
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
      for (; told < times.length && times[told] <= clock; told++) watch.changed();
    },
  });
  return { watch };
}

test('a screen that is not changing is still after the shortest watch', async () => {
  expect(await screenThatChangesAt([]).watch.pixelsStill()).toEqual({
    movedForMs: 0,
    stillMoving: false,
  });
});

test('a screen that animates is still once its picture stops changing', async () => {
  const fade = [48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208];

  expect(await screenThatChangesAt(fade).watch.pixelsStill()).toEqual({
    movedForMs: 208,
    stillMoving: false,
  });
});

test('a screen that never stops is given up on, and the result says so', async () => {
  const spinner = Array.from({ length: 200 }, (_, index) => index * 16);

  expect(await screenThatChangesAt(spinner).watch.pixelsStill()).toEqual({
    movedForMs: 904,
    stillMoving: true,
  });
});

test('a change from before the watch began is not counted as the step moving the screen', async () => {
  const { watch } = screenThatChangesAt([]);
  watch.changed();

  expect((await watch.pixelsStill()).movedForMs).toBe(0);
});

test('a recorder exiting cleanly before stop is incomplete coverage', async () => {
  const child = spawn(
    process.execPath,
    ['-e', `console.error('Recording started'); setTimeout(() => process.exit(0), 20)`],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const recording = await recordSimulator('test-only', '/unused', { launch: () => child });
  await exited;
  await expect(recording.stop()).rejects.toThrow('before stop');
});

async function recorderProcess(
  script: string,
  check: (child: ReturnType<typeof launchTestRecorder>, exited: Promise<void>) => Promise<void>
) {
  const child = launchTestRecorder(script);
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  // Also bound a regressed implementation that never returns from stop().
  const guard = setTimeout(() => child.kill('SIGKILL'), 4000);
  try {
    await check(child, exited);
  } finally {
    clearTimeout(guard);
    child.kill('SIGKILL');
    await exited;
  }
}
const launchTestRecorder = (script: string) =>
  spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });

test('normal stop waits for successful finalization and is repeatable', () =>
  recorderProcess(
    `
  process.on('SIGINT', () => setTimeout(() => process.exit(0), 20));
  console.error('Recording started'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordSimulator('test-only', '/unused', { launch: () => child });
      await Promise.all([recording.stop(), recording.stop()]);
      await recording.stop();
      expect(child.exitCode).toBe(0);
    }
  ));

test('a crash after readiness is not a completed recording', () =>
  recorderProcess(
    `
  console.error('Recording started'); setTimeout(() => process.exit(7), 20);
`,
    async (child, exited) => {
      const recording = await recordSimulator('test-only', '/unused', { launch: () => child });
      await exited;
      await expect(recording.stop()).rejects.toThrow('before stop: code 7');
    }
  ));

test('early startup exit is reported with its actual status', () =>
  recorderProcess(`process.exit(3)`, async (child) => {
    await expect(
      recordSimulator('test-only', '/unused', { launch: () => child, startupMs: 1000 })
    ).rejects.toThrow('before readiness: code 3');
    expect(child.exitCode).toBe(3);
  }));

test('startup deadline reaps a silent recorder before rejecting', () =>
  recorderProcess(`setInterval(() => {}, 1000)`, async (child) => {
    await expect(
      recordSimulator('test-only', '/unused', { launch: () => child, startupMs: 50 })
    ).rejects.toThrow('did not start recording');
    expect(child.signalCode).toBe('SIGKILL');
  }));

test('ignored graceful stop fails and reaps the recorder; repeated stop stays failed', () =>
  recorderProcess(
    `
  process.on('SIGINT', () => {}); console.error('Recording started'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordSimulator('test-only', '/unused', {
        launch: () => child,
        stopMs: 50,
      });
      await expect(recording.stop()).rejects.toThrow('did not stop gracefully');
      expect(child.signalCode).toBe('SIGKILL');
      await expect(recording.stop()).rejects.toThrow('did not stop gracefully');
    }
  ));

test('failed flush after requested stop is not success', () =>
  recorderProcess(
    `
  process.on('SIGINT', () => process.exit(9)); console.error('Recording started'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordSimulator('test-only', '/unused', { launch: () => child });
      await expect(recording.stop()).rejects.toThrow('did not finalize successfully: code 9');
      expect(child.exitCode).toBe(9);
    }
  ));

test('spawn failure does not wait for a nonexistent process to exit', async () => {
  await expect(
    recordSimulator('test-only', '/unused', {
      launch: () =>
        spawn('/nonexistent-sovran-test-recorder', [], { stdio: ['ignore', 'ignore', 'pipe'] }),
    })
  ).rejects.toThrow('before readiness');
});

test('an operational error does not count as termination of a live recorder', () =>
  recorderProcess(
    `
  console.error('Recording started'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordSimulator('test-only', '/unused', { launch: () => child });
      child.emit('error', new Error('injected signal-delivery failure'));
      await expect(recording.stop()).rejects.toThrow('injected signal-delivery failure');
      expect(child.signalCode).toBe('SIGKILL');
    }
  ));
