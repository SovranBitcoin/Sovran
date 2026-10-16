import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'bun:test';
import {
  captureSimulatorScreen,
  createScreenWatch,
  pictureName,
  recordAndroid,
  recordSimulator,
} from './evidence';

test("a step's picture is named by its place in the story and what it does", () => {
  expect(pictureName(1, 'agree to the Terms')).toBe('02-agree-to-the-terms');
});

function sampleFrame(value: string) {
  return { jpeg: Buffer.from(value), pixels: Buffer.from(value), width: 1, height: 1 };
}

test('screen settling samples the current display even after an earlier still screen', async () => {
  let clock = 0;
  let samples = 0;
  let moving = false;
  const watch = createScreenWatch({
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
    },
    capture: async () => {
      samples++;
      return sampleFrame(moving ? String(clock) : 'static');
    },
  });
  expect((await watch.pixelsStill()).stillMoving).toBe(false);
  moving = true;
  expect((await watch.pixelsStill()).stillMoving).toBe(true);
  expect(samples).toBeGreaterThan(2);
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
  spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });

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

test('a checkpoint asks for a new capture, including an unchanged screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sovran-screen-'));
  let calls = 0;
  const frames = ['legal', 'setup', 'setup'];
  const watch = createScreenWatch({
    capture: async () => sampleFrame(frames[calls++] ?? 'new'),
    now: () => 0,
    wait: async () => {},
  });
  try {
    for (const index of [0, 1, 2]) await watch.picture(join(dir, `${index}.jpg`));
    expect([0, 1, 2].map((index) => readFileSync(join(dir, `${index}.jpg`), 'utf8'))).toEqual(
      frames
    );
    await expect(watch.picture(join(dir, '0.jpg'))).rejects.toThrow();
    expect(readFileSync(join(dir, '0.jpg'), 'utf8')).toBe('legal');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a failed fresh capture cannot reuse a previous picture or settle a screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sovran-screen-'));
  let calls = 0;
  const watch = createScreenWatch({
    capture: async () => {
      if (calls++) throw Error('capture stopped');
      return sampleFrame('valid');
    },
    now: () => 0,
    wait: async () => {},
  });
  try {
    await watch.picture(join(dir, 'first.jpg'));
    await expect(watch.picture(join(dir, 'second.jpg'))).rejects.toThrow('capture stopped');
    await expect(watch.pixelsStill()).rejects.toThrow('capture stopped');
    expect(existsSync(join(dir, 'second.jpg'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('capture latency cannot supply the quiet interval or extend its deadline', async () => {
  let clock = 0;
  const starts: number[] = [];
  let captureMs = 80;
  const watch = createScreenWatch({
    capture: async () => {
      starts.push(clock);
      clock += captureMs;
      return sampleFrame('same');
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });
  expect(await watch.pixelsStill(100, 300)).toEqual({ movedForMs: 0, stillMoving: false });
  expect(starts).toEqual([0, 180]);
  captureMs = 80;
  let count = 0;
  const late = createScreenWatch({
    capture: async () => {
      clock += count++ === 0 ? 80 : 150;
      return sampleFrame('same');
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });
  await expect(late.pixelsStill(100, 300)).rejects.toThrow('settling deadline');
});

test('equal pixels with different JPEG encodings count as equal samples', async () => {
  let clock = 0;
  let captures = 0;
  const watch = createScreenWatch({
    capture: async () => ({ ...sampleFrame('pixels'), jpeg: Buffer.from(String(captures++)) }),
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });
  expect((await watch.pixelsStill()).stillMoving).toBe(false);
  expect(captures).toBe(2);
});

test('simulator capture validates fresh child output, not an old file or header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sovran-capture-'));
  const jpeg = await sharp({ create: { width: 4, height: 5, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
  const input = join(dir, 'input.jpg');
  const script = join(dir, 'capture.cjs');
  writeFileSync(input, jpeg);
  writeFileSync(
    script,
    `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(input)}))`
  );
  const command: [string, ...string[]] = [process.execPath, script];
  try {
    expect(await captureSimulatorScreen('owned-test', 1000, command)).toMatchObject({
      jpeg,
      width: 4,
      height: 5,
    });
    writeFileSync(input, jpeg.subarray(0, Math.floor(jpeg.length * 0.7)));
    await expect(captureSimulatorScreen('owned-test', 1000, command)).rejects.toThrow();
    writeFileSync(input, '');
    await expect(captureSimulatorScreen('owned-test', 1000, command)).rejects.toThrow();
    writeFileSync(script, `process.exit(7)`);
    await expect(captureSimulatorScreen('owned-test', 1000, command)).rejects.toThrow();
    writeFileSync(script, `setInterval(() => {}, 1000)`);
    await expect(captureSimulatorScreen('owned-test', 30, command)).rejects.toThrow();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('healthy moving samples exhaust observation without starting a capture that cannot fit', async () => {
  let clock = 0;
  const watch = createScreenWatch({
    capture: async () => {
      clock += 300;
      return sampleFrame(String(clock));
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });
  expect(await watch.pixelsStill()).toEqual({ movedForMs: 2700, stillMoving: true });
  expect(clock).toBe(2700);
});

test('a capture rejection after a successful baseline is never a still screen', async () => {
  let clock = 0;
  let captured = false;
  const watch = createScreenWatch({
    capture: async () => {
      if (captured) throw Error('display unavailable');
      captured = true;
      return sampleFrame('same');
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
  });
  await expect(watch.pixelsStill()).rejects.toThrow('display unavailable');
});

test('an Android recording is ready when screenrecord reports its content area', () =>
  recorderProcess(
    `
  process.on('SIGINT', () => process.exit(0));
  console.log('Configuring recorder'); setTimeout(() => console.log('Content area is 1080x2400'), 20);
  setInterval(() => {}, 1000);
`,
    async (child) => {
      let interrupted = 0;
      const recording = await recordAndroid(['adb', '-s', 'test-only'], {
        launch: () => child,
        interrupt: async () => {
          interrupted++;
          child.kill('SIGINT');
        },
      });
      await recording.stop();
      expect(interrupted).toBe(1);
      expect(child.exitCode).toBe(0);
    }
  ));

test('Android stop interrupts on the device, not the local adb client', () =>
  recorderProcess(
    `
  process.on('SIGINT', () => process.exit(5));
  console.log('Content area is 1080x2400'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordAndroid(['adb', '-s', 'test-only'], {
        launch: () => child,
        stopMs: 100,
        interrupt: async () => {},
      });
      // A local SIGINT would exit 5; the device interrupt is what stop sends.
      await expect(recording.stop()).rejects.toThrow('did not stop gracefully');
      expect(child.signalCode).toBe('SIGKILL');
    }
  ));

test('a failed device interrupt fails the recording and reaps the client', () =>
  recorderProcess(
    `
  console.log('Content area is 1080x2400'); setInterval(() => {}, 1000);
`,
    async (child) => {
      const recording = await recordAndroid(['adb', '-s', 'test-only'], {
        launch: () => child,
        interrupt: async () => {
          throw new Error('device gone');
        },
      });
      await expect(recording.stop()).rejects.toThrow('device gone');
      expect(child.signalCode).toBe('SIGKILL');
    }
  ));

test('screenrecord stopping itself at its time limit is a gap, not a recording', () =>
  recorderProcess(
    `
  console.log('Content area is 1080x2400'); setTimeout(() => process.exit(0), 20);
`,
    async (child, exited) => {
      const recording = await recordAndroid(['adb', '-s', 'test-only'], { launch: () => child });
      await exited;
      await expect(recording.stop()).rejects.toThrow('before stop');
    }
  ));
