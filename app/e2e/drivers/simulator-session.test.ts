import { describe, expect, it } from 'bun:test';

import {
  buildDevClientUrl,
  buildMetroEnvironment,
  createEphemeralSimulatorDevice,
  parseOwnedServeSimMetadata,
  resolveExpoBin,
  resolveServeSimNativeAddon,
  sanitizeMetroLogLine,
  sanitizeSimulatorBridgeLog,
  selectSimulatorTarget,
  SimulatorRunInterrupted,
  SimulatorInfrastructureError,
  startPrivateSeedExportServer,
  withEphemeralSimulatorSession,
  type RunSignal,
} from './simulator-session';
import type { RunOptions } from './simctl';

const OWNED_UDID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const SECOND_UDID = '11111111-2222-4333-8444-555555555555';
const EXISTING_UDID = '99999999-8888-4777-8666-555555555555';
const PRIVATE_SEED_EXPORT = {
  endpoint: 'http://127.0.0.1:41003/seed',
  token: 'a'.repeat(64),
};

const runtimes = JSON.stringify({
  runtimes: [
    {
      isAvailable: true,
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
      name: 'iOS 18.3',
      version: '18.3.1',
      platform: 'iOS',
      supportedDeviceTypes: [
        {
          name: 'iPhone 16 Pro',
          identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
          productFamily: 'iPhone',
        },
      ],
    },
    {
      isAvailable: true,
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
      name: 'iOS 26.2',
      version: '26.2',
      platform: 'iOS',
      supportedDeviceTypes: [
        {
          name: 'iPhone 17 Pro',
          identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
          productFamily: 'iPhone',
        },
      ],
    },
  ],
});

type Call = { command: string[]; options?: RunOptions };

function commandFake(options: { udids?: string[]; failOn?: string } = {}) {
  const calls: Call[] = [];
  const udids = [...(options.udids ?? [OWNED_UDID])];
  const execute = async (command: string[], commandOptions?: RunOptions): Promise<string> => {
    calls.push({ command, options: commandOptions });
    if (command[2] === 'list' && command[3] === 'runtimes') return runtimes;
    if (command[2] === 'create') return udids.shift() ?? OWNED_UDID;
    if (command[2] === options.failOn) throw new Error(`${options.failOn} failed`);
    return '';
  };
  return { calls, execute };
}

describe('ephemeral simulator target selection', () => {
  it('uses the preferred compatible device from the newest available iOS runtime', () => {
    expect(selectSimulatorTarget(runtimes)).toEqual({
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
      runtimeName: 'iOS 26.2',
      runtimeVersion: '26.2',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
      deviceTypeName: 'iPhone 17 Pro',
    });
  });

  it('fails closed when no available runtime has a compatible iPhone', () => {
    expect(() => selectSimulatorTarget('{"runtimes":[]}')).toThrow(/no available iOS runtime/);
    expect(() => selectSimulatorTarget('not-json')).toThrow(/invalid runtime JSON/);
  });
});

describe('ephemeral simulator ownership fence', () => {
  it('creates, boots, and deletes only the UDID returned by create without device discovery or erase', async () => {
    const fake = commandFake();
    const device = await createEphemeralSimulatorDevice({ runId: 'test-run' }, fake.execute);

    expect(device.udid).toBe(OWNED_UDID);
    expect(device.name).toMatch(/^Sovran E2E test-run-[0-9a-f]{8}$/);
    expect(fake.calls.map(({ command }) => command.slice(0, 4))).toEqual(
      expect.arrayContaining([
        ['xcrun', 'simctl', 'list', 'runtimes'],
        ['xcrun', 'simctl', 'create', device.name],
        ['xcrun', 'simctl', 'boot', OWNED_UDID],
        ['xcrun', 'simctl', 'bootstatus', OWNED_UDID],
      ])
    );
    expect(fake.calls.some(({ command }) => command.includes('devices'))).toBe(false);
    expect(fake.calls.some(({ command }) => command.includes('erase'))).toBe(false);

    await Promise.all([device.dispose(), device.dispose()]);
    const deletes = fake.calls.filter(({ command }) => command[2] === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.command).toEqual(['xcrun', 'simctl', 'delete', OWNED_UDID]);
    expect(deletes[0]?.command).not.toContain(EXISTING_UDID);
  });

  it('uses a unique name for concurrent sessions', async () => {
    const fake = commandFake({ udids: [OWNED_UDID, SECOND_UDID] });
    const [first, second] = await Promise.all([
      createEphemeralSimulatorDevice({ runId: 'same-run' }, fake.execute),
      createEphemeralSimulatorDevice({ runId: 'same-run' }, fake.execute),
    ]);
    expect(first.name).not.toBe(second.name);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it('self-deletes only the captured UDID when boot setup fails', async () => {
    const fake = commandFake({ failOn: 'bootstatus' });
    await expect(
      createEphemeralSimulatorDevice({ runId: 'failed-run' }, fake.execute)
    ).rejects.toThrow(/bootstatus failed/);
    expect(fake.calls.filter(({ command }) => command[2] === 'delete')).toEqual([
      expect.objectContaining({ command: ['xcrun', 'simctl', 'delete', OWNED_UDID] }),
    ]);
    expect(fake.calls.flatMap(({ command }) => command)).not.toContain(EXISTING_UDID);
  });
});

describe('owned host configuration', () => {
  it('resolves only serve-sim native primitives for the capture-free E2E bridge', () => {
    expect(resolveServeSimNativeAddon()).toMatch(/serve-sim-native\.node$/);
  });

  it('accepts only the expected owned loopback serve-sim endpoints', () => {
    const valid = JSON.stringify({
      device: OWNED_UDID,
      streamUrl: 'http://127.0.0.1:41002/stream',
      wsUrl: 'ws://127.0.0.1:41002/ws',
      port: 41002,
    });
    expect(parseOwnedServeSimMetadata(valid, OWNED_UDID, 41002)).toEqual({
      axEndpoint: 'http://127.0.0.1:41002/ax',
      touchEndpoint: 'ws://127.0.0.1:41002/ws',
      port: 41002,
    });
    expect(() =>
      parseOwnedServeSimMetadata(
        JSON.stringify({
          device: OWNED_UDID,
          streamUrl: 'https://evil.example:41002/stream',
          wsUrl: 'ws://evil.example:41002/ws',
          port: 41002,
        }),
        OWNED_UDID,
        41002
      )
    ).toThrow(/owned loopback/);
    expect(() =>
      parseOwnedServeSimMetadata(
        JSON.stringify({
          device: OWNED_UDID,
          streamUrl: 'http://127.0.0.1:41003/stream',
          wsUrl: 'ws://127.0.0.1:41003/ws',
          port: 41003,
        }),
        OWNED_UDID,
        41002
      )
    ).toThrow(/owned loopback/);
    expect(() => parseOwnedServeSimMetadata(valid, SECOND_UDID, 41002)).toThrow(
      /unexpected device/
    );
  });

  it('resolves a hoisted Expo CLI without starting it', () => {
    expect(resolveExpoBin('/test-app', (path) => path === '/node_modules/.bin/expo')).toBe(
      '/node_modules/.bin/expo'
    );
    expect(() => resolveExpoBin('/missing-app', () => false)).toThrow(/Expo CLI not found/);
  });

  it('strips seed/debug and inherited Metro variables', () => {
    const environment = buildMetroEnvironment({
      KEEP_ME: 'yes',
      DEBUG_MNEMONIC: 'secret',
      EXPO_PUBLIC_DEBUG_MNEMONIC: 'secret',
      EXPO_PUBLIC_E2E_SEED_EXPORT: '1',
      EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT: 'http://127.0.0.1:1/seed',
      EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN: 'must-not-survive',
      EXPO_PUBLIC_E2E_FUNDED_ASSETS: 'must-not-survive',
      EXPO_PUBLIC_E2E_MOCK_FAIL_PAYMENT_REQUEST: '1',
      EXPO_PUBLIC_E2E_TOAST_DISMISS_MS: '3000',
      EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS: '9999',
      EXPO_PUBLIC_E2E_STATE_MIRROR: '0',
      RCT_METRO_PORT: '8082',
    });
    expect(environment).toEqual({
      KEEP_ME: 'yes',
      NODE_OPTIONS: '--dns-result-order=ipv4first',
      EXPO_PUBLIC_E2E_ONBOARDING_SLIDE_MS: '180000',
      EXPO_PUBLIC_E2E_TOAST_DISMISS_MS: '8000',
      EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS: '180000',
      EXPO_PUBLIC_E2E_STATE_MIRROR: '1',
    });
  });

  it('injects private seed IPC only for an explicitly funded Metro session', () => {
    const environment = buildMetroEnvironment(
      {
        DEBUG_MNEMONIC: 'must-not-survive',
        EXPO_PUBLIC_DEBUG_MNEMONIC: 'must-not-survive',
      },
      { seedExport: PRIVATE_SEED_EXPORT }
    );
    expect(environment.DEBUG_MNEMONIC).toBeUndefined();
    expect(environment.EXPO_PUBLIC_DEBUG_MNEMONIC).toBeUndefined();
    expect(environment.EXPO_PUBLIC_E2E_SEED_EXPORT).toBeUndefined();
    expect(environment.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT).toBe(PRIVATE_SEED_EXPORT.endpoint);
    expect(environment.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN).toBe(PRIVATE_SEED_EXPORT.token);
  });

  it('injects a validated public P2PK target only into a funded Metro session', () => {
    const pubkey = `02${'11'.repeat(32)}`;
    const environment = buildMetroEnvironment(
      { EXPO_PUBLIC_E2E_CONTROLLED_P2PK_PUBKEY: `02${'22'.repeat(32)}` },
      { seedExport: PRIVATE_SEED_EXPORT, controlledP2PKPubkey: pubkey }
    );
    expect(environment.EXPO_PUBLIC_E2E_CONTROLLED_P2PK_PUBKEY).toBe(pubkey);
    expect(() =>
      buildMetroEnvironment(
        {},
        { seedExport: PRIVATE_SEED_EXPORT, controlledP2PKPubkey: 'not-a-key' }
      )
    ).toThrow(/controlled P2PK public key/);
    expect(() => buildMetroEnvironment({}, { controlledP2PKPubkey: pubkey })).toThrow(
      /funded Metro session/
    );
  });

  it('injects compact funded assets only beside private seed custody', () => {
    const environment = buildMetroEnvironment(
      { EXPO_PUBLIC_E2E_FUNDED_ASSETS: 'inherited-must-not-survive' },
      {
        seedExport: PRIVATE_SEED_EXPORT,
        fundedAssets: [{ mintUrl: 'https://mint.sovran.money/', unit: 'SAT' }],
      }
    );
    expect(environment.EXPO_PUBLIC_E2E_FUNDED_ASSETS).toBe(
      '{"version":1,"assets":[{"mintUrl":"https://mint.sovran.money","unit":"sat"}]}'
    );
    expect(() =>
      buildMetroEnvironment(
        {},
        { fundedAssets: [{ mintUrl: 'https://mint.sovran.money', unit: 'sat' }] }
      )
    ).toThrow(/funded Metro session/);
  });

  it('arms mint faults with an EMPTY rule set and never inherits one', () => {
    const inherited = buildMetroEnvironment({ EXPO_PUBLIC_E2E_MINT_FAULTS: 'must-not-survive' });
    expect(inherited.EXPO_PUBLIC_E2E_MINT_FAULTS).toBeUndefined();
    const armed = buildMetroEnvironment({}, { armMintFaults: true });
    expect(armed.EXPO_PUBLIC_E2E_MINT_FAULTS).toBe('{"version":1,"revision":0,"rules":[]}');
  });

  it('injects the payment-request failure mock only beside private seed custody', () => {
    const environment = buildMetroEnvironment(
      { EXPO_PUBLIC_E2E_MOCK_FAIL_PAYMENT_REQUEST: 'inherited-must-not-survive' },
      { seedExport: PRIVATE_SEED_EXPORT, mockFailPaymentRequest: true }
    );
    expect(environment.EXPO_PUBLIC_E2E_MOCK_FAIL_PAYMENT_REQUEST).toBe('1');
    expect(() => buildMetroEnvironment({}, { mockFailPaymentRequest: true })).toThrow(
      /funded Metro session/
    );
  });

  it('rejects legacy console seed export before the Metro line is persisted', () => {
    const mnemonic = Array.from({ length: 24 }, () => 'abandon').join(' ');
    expect(() => sanitizeMetroLogLine(` LOG  E2E_SEED_EXPORT ${mnemonic}\n`)).toThrow(
      /forbidden legacy E2E seed export/
    );
    expect(sanitizeMetroLogLine('ordinary Metro output\n')).toBe('ordinary Metro output\n');
  });

  it('keeps the private bridge log empty when Bun only reports its tsconfig warning', () => {
    expect(
      sanitizeSimulatorBridgeLog(`14 |     "moduleSuffixes": [".ios", ".android", ""],
         ^
warn: moduleSuffixes is not supported yet
   at /tmp/app/tsconfig.json:14:5
`)
    ).toBe('');
    expect(sanitizeSimulatorBridgeLog('[bridge] native AX failed\n')).toBe(
      '[bridge] native AX failed'
    );
  });

  it('accepts the mnemonic only over authenticated loopback IPC', async () => {
    const captured: string[] = [];
    const server = await startPrivateSeedExportServer((mnemonic) => captured.push(mnemonic));
    try {
      // eslint-disable-next-line no-restricted-properties -- exercises the private loopback HTTP boundary itself
      const rejected = await globalThis.fetch(server.endpoint, {
        method: 'POST',
        headers: { 'x-sovran-e2e-token': 'b'.repeat(64) },
        body: 'must not be captured',
      });
      expect(rejected.status).toBe(404);

      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      // eslint-disable-next-line no-restricted-properties -- exercises the private loopback HTTP boundary itself
      const accepted = await globalThis.fetch(server.endpoint, {
        method: 'POST',
        headers: { 'x-sovran-e2e-token': server.token },
        body: mnemonic,
      });
      expect(accepted.status).toBe(204);
      expect(captured).toEqual([mnemonic]);
    } finally {
      await server.stop();
    }
  });

  it('injects the session-specific Metro URL into the dev-client deep link', () => {
    const first = new URL(buildDevClientUrl('http://127.0.0.1:41001'));
    const second = new URL(buildDevClientUrl('http://127.0.0.1:41002'));
    expect(first.host).toBe('expo-development-client');
    expect(first.searchParams.get('url')).toBe('http://127.0.0.1:41001');
    expect(second.searchParams.get('url')).toBe('http://127.0.0.1:41002');
  });
});

describe('session cleanup and signals', () => {
  it('rejects the payment-request failure mock before setup without private seed custody', async () => {
    let findAppCalled = false;
    await expect(
      withEphemeralSimulatorSession(
        {
          runId: 'unfunded-payment-request-mock',
          runDir: '/tmp/unfunded-payment-request-mock',
          mockFailPaymentRequest: true,
        },
        async () => {},
        {
          findApp: async () => {
            findAppCalled = true;
            return '/tmp/Sovran.app';
          },
          signals: { on: () => {}, off: () => {} },
        }
      )
    ).rejects.toThrow(/funded simulator session/);
    expect(findAppCalled).toBe(false);
  });

  it('forwards the funded payment-request failure mock to the owned Metro session', async () => {
    let receivedMockFlag: boolean | undefined;
    await withEphemeralSimulatorSession(
      {
        runId: 'funded-payment-request-mock',
        runDir: '/tmp/funded-payment-request-mock',
        onSeedExport: () => {},
        fundedAssets: [{ mintUrl: 'https://mint.sovran.money', unit: 'sat' }],
        mockFailPaymentRequest: true,
      },
      async () => {},
      {
        findApp: async () => '/tmp/Sovran.app',
        startMetro: async (_runDir, _signal, options) => {
          receivedMockFlag = options?.mockFailPaymentRequest;
          return {
            url: 'http://127.0.0.1:41001',
            port: 41001,
            pid: 1,
            logPath: '/tmp/metro.log',
            stop: async () => {},
          };
        },
        createDevice: async () => ({
          udid: OWNED_UDID,
          name: 'owned',
          runtimeIdentifier: 'runtime',
          runtimeName: 'iOS',
          runtimeVersion: '26.2',
          deviceTypeIdentifier: 'device',
          deviceTypeName: 'iPhone',
          dispose: async () => {},
        }),
        startServeSim: async () => ({
          axEndpoint: 'http://127.0.0.1:41002/ax',
          touchEndpoint: 'ws://127.0.0.1:41002/ws',
          port: 41002,
          pid: 2,
          logPath: '/tmp/simulator-bridge.log',
          onUnexpectedExit: () => () => {},
          stop: async () => {},
        }),
        signals: { on: () => {}, off: () => {} },
      }
    );
    expect(receivedMockFlag).toBe(true);
  });

  it('fails before host setup when no installable app exists', async () => {
    let setupCalled = false;
    await expect(
      withEphemeralSimulatorSession(
        { runId: 'missing-app', runDir: '/tmp/missing-app' },
        async () => {},
        {
          findApp: async () => {
            throw new Error('no installable app');
          },
          startMetro: async () => {
            setupCalled = true;
            throw new Error('must not start');
          },
          signals: { on: () => {}, off: () => {} },
        }
      )
    ).rejects.toThrow(/no installable app/);
    expect(setupCalled).toBe(false);
  });

  it('unwinds acquired resources when serve-sim setup fails', async () => {
    const cleanup: string[] = [];
    let callbackCalled = false;
    await expect(
      withEphemeralSimulatorSession(
        { runId: 'partial-run', runDir: '/tmp/partial-run' },
        async () => {
          callbackCalled = true;
        },
        {
          findApp: async () => '/tmp/Sovran.app',
          startMetro: async () => ({
            url: 'http://localhost:41001',
            port: 41001,
            pid: 1,
            logPath: '/tmp/metro.log',
            stop: async () => void cleanup.push('metro'),
          }),
          createDevice: async () => ({
            udid: OWNED_UDID,
            name: 'owned',
            runtimeIdentifier: 'runtime',
            runtimeName: 'iOS',
            runtimeVersion: '26.2',
            deviceTypeIdentifier: 'device',
            deviceTypeName: 'iPhone',
            dispose: async () => void cleanup.push('device'),
          }),
          startServeSim: async () => {
            throw new Error('serve-sim setup failed');
          },
          signals: { on: () => {}, off: () => {} },
        }
      )
    ).rejects.toThrow(/serve-sim setup failed/);
    expect(callbackCalled).toBe(false);
    expect(cleanup).toEqual(['metro', 'device']);
  });

  it('stops owned processes before deleting the device after SIGINT', async () => {
    const listeners = new Map<RunSignal, () => void>();
    const cleanup: string[] = [];
    let callbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      callbackStarted = resolve;
    });
    const running = withEphemeralSimulatorSession(
      { runId: 'signal-run', runDir: '/tmp/signal-run' },
      async (_session, signal) => {
        callbackStarted();
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      {
        findApp: async () => '/tmp/Sovran.app',
        startMetro: async () => ({
          url: 'http://127.0.0.1:41001',
          port: 41001,
          pid: 1,
          logPath: '/tmp/metro.log',
          stop: async () => void cleanup.push('metro'),
        }),
        createDevice: async () => ({
          udid: OWNED_UDID,
          name: 'owned',
          runtimeIdentifier: 'runtime',
          runtimeName: 'iOS',
          runtimeVersion: '26.2',
          deviceTypeIdentifier: 'device',
          deviceTypeName: 'iPhone',
          dispose: async () => void cleanup.push('device'),
        }),
        startServeSim: async () => ({
          axEndpoint: 'http://127.0.0.1:41002/ax',
          touchEndpoint: 'ws://127.0.0.1:41002/ws',
          port: 41002,
          pid: 2,
          logPath: '/tmp/simulator-bridge.log',
          onUnexpectedExit: () => () => {},
          stop: async () => void cleanup.push('serve-sim'),
        }),
        signals: {
          on: (signal, listener) => void listeners.set(signal, listener),
          off: (signal) => void listeners.delete(signal),
        },
      }
    );
    await started;
    listeners.get('SIGINT')?.();

    await expect(running).rejects.toBeInstanceOf(SimulatorRunInterrupted);
    expect(cleanup).toEqual(['serve-sim', 'metro', 'device']);
    expect(listeners.size).toBe(0);
  });

  it('aborts the scenario immediately when the owned bridge exits unexpectedly', async () => {
    const cleanup: string[] = [];
    let reportExit!: (error: SimulatorInfrastructureError) => void;
    let callbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      callbackStarted = resolve;
    });
    const running = withEphemeralSimulatorSession(
      { runId: 'bridge-crash', runDir: '/tmp/bridge-crash' },
      async (_session, signal) => {
        callbackStarted();
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      {
        findApp: async () => '/tmp/Sovran.app',
        startMetro: async () => ({
          url: 'http://127.0.0.1:41001',
          port: 41001,
          pid: 1,
          logPath: '/tmp/metro.log',
          stop: async () => void cleanup.push('metro'),
        }),
        createDevice: async () => ({
          udid: OWNED_UDID,
          name: 'owned',
          runtimeIdentifier: 'runtime',
          runtimeName: 'iOS',
          runtimeVersion: '26.2',
          deviceTypeIdentifier: 'device',
          deviceTypeName: 'iPhone',
          dispose: async () => void cleanup.push('device'),
        }),
        startServeSim: async () => ({
          axEndpoint: 'http://127.0.0.1:41002/ax',
          touchEndpoint: 'ws://127.0.0.1:41002/ws',
          port: 41002,
          pid: 2,
          logPath: '/tmp/simulator-bridge.log',
          onUnexpectedExit(listener) {
            reportExit = listener;
            return () => {};
          },
          stop: async () => void cleanup.push('bridge'),
        }),
        signals: { on: () => {}, off: () => {} },
      }
    );
    await started;
    const failure = new SimulatorInfrastructureError('bridge crashed');
    reportExit(failure);

    await expect(running).rejects.toBe(failure);
    expect(cleanup).toEqual(['bridge', 'metro', 'device']);
  });
});
