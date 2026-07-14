import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import {
  assertSuccessfulExit,
  automaticSensitiveMaskFrames,
  createPrivateScreenshotTarget,
  findSimulatorElement,
  fundedSweepProbeComplete,
  maskScreenshotBytes,
  AxWatcher,
  parseTransactionProbe,
  SimulatorDriver,
} from './simulator';
import type { AxSnapshot } from './ax';

const snapshot = (label: string): AxSnapshot => ({
  screen: { width: 400, height: 800 },
  elements: [
    {
      id: label,
      label,
      frame: { x: 10, y: 10, width: 40, height: 40 },
    },
  ],
});

describe('AxWatcher navigation freshness', () => {
  it('invalidates both the cached tree and its generation barrier', () => {
    const watcher = new AxWatcher('unused');
    const stale = snapshot('stale-wallet');
    watcher.update(stale);
    const staleGeneration = watcher.generation;

    const navigationGeneration = watcher.invalidate();

    expect(navigationGeneration).toBeGreaterThan(staleGeneration);
    expect(watcher.latest).toBeNull();
    expect(watcher.snapshotAfter(navigationGeneration)).toBeNull();

    const fresh = snapshot('fresh-destination');
    watcher.update(fresh);
    expect(watcher.snapshotAfter(navigationGeneration)).toBe(fresh);
  });

  it('does not let an AX update during install satisfy launch freshness', async () => {
    const watcher = new AxWatcher('unused');
    const duringInstall = snapshot('during-install');
    const afterInstall = snapshot('after-install');
    const driver = new SimulatorDriver(
      { udid: 'offline-test', axEndpoint: 'unused', touchEndpoint: 'unused', pollMs: 1 },
      {
        axWatcher: watcher,
        install: async () => {
          watcher.update(duringInstall);
        },
      }
    );

    let settled = false;
    const launching = driver.launch('none').then(() => {
      settled = true;
    });
    await Bun.sleep(5);

    expect(settled).toBe(false);
    expect(watcher.latest).toBeNull();

    watcher.update(afterInstall);
    await launching;
    expect(watcher.latest).toBe(afterInstall);
  });
});

describe('SimulatorDriver fail-closed host boundaries', () => {
  it('creates raw screenshot storage owner-only and removes it as one scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-shot-test-'));
    try {
      const target = createPrivateScreenshotTarget(root);

      expect(statSync(target.directory).mode & 0o777).toBe(0o700);
      expect(statSync(target.path).mode & 0o777).toBe(0o600);

      target.cleanup();
      expect(existsSync(target.directory)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws for unsupported units and missing SAT observations', async () => {
    const driver = new SimulatorDriver({
      udid: 'offline-test',
      axEndpoint: 'unused',
      touchEndpoint: 'unused',
    });
    await expect(driver.balance('usd')).rejects.toThrow(/unsupported balance unit.*usd/);
    await expect(driver.balance('sat')).rejects.toThrow(/SAT balance.*not observable/);
  });

  it('parses only the strict non-secret transaction probe contract', () => {
    expect(
      parseTransactionProbe(
        JSON.stringify({
          direction: 'out',
          amount: 40,
          unit: 'sat',
          mintHost: 'mint.sovran.money',
          status: 'PAID',
          source: 'paste',
        })
      )
    ).toEqual({
      direction: 'out',
      amount: 40,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'PAID',
      source: 'paste',
    });
    expect(
      parseTransactionProbe(
        JSON.stringify({
          direction: 'in',
          amount: 100,
          unit: 'sat',
          mintHost: 'mint.sovran.money',
          status: 'UNPAID',
          source: null,
        })
      )
    ).toEqual({
      direction: 'in',
      amount: 100,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'UNPAID',
      source: null,
    });
    expect(() =>
      parseTransactionProbe('{"direction":"out","amount":40,"token":"cashuAsecret"}')
    ).toThrow(/unexpected field.*token/);
    expect(() => parseTransactionProbe('not-json')).toThrow(/invalid transaction probe JSON/);
  });

  it('waits for exact zero remaining value in every funded asset probe', () => {
    const expected = [{ mintUrl: 'https://mint.sovran.money', unit: 'sat' }];
    expect(
      fundedSweepProbeComplete(
        JSON.stringify({
          version: 1,
          phase: 'running',
          assets: 1,
          checked: 0,
          spent: 0,
          remaining: [],
        }),
        expected
      )
    ).toBe(false);
    expect(
      fundedSweepProbeComplete(
        JSON.stringify({
          version: 1,
          phase: 'complete',
          assets: 1,
          checked: 2,
          spent: 2,
          remaining: [{ mintUrl: 'https://mint.sovran.money', unit: 'sat', amount: 0 }],
        }),
        expected
      )
    ).toBe(true);
    expect(() =>
      fundedSweepProbeComplete(
        JSON.stringify({
          version: 1,
          phase: 'failed',
          assets: 1,
          checked: 0,
          spent: 0,
          remaining: [],
        }),
        expected
      )
    ).toThrow(/reconciliation failed/);
  });

  it('reads a transaction only from its exact structured probe id', async () => {
    const watcher = new AxWatcher('unused');
    watcher.update({
      screen: { width: 400, height: 800 },
      elements: [
        {
          id: 'transaction-probe-tx-123',
          value:
            '{"direction":"in","amount":50,"unit":"sat","mintHost":"mint.sovran.money","status":"PAID","source":"paste"}',
          frame: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    const driver = new SimulatorDriver(
      { udid: 'offline-test', axEndpoint: 'unused', touchEndpoint: 'unused' },
      { axWatcher: watcher }
    );
    await expect(driver.transaction('tx-123')).resolves.toMatchObject({
      direction: 'in',
      amount: 50,
      source: 'paste',
    });
    await expect(driver.transaction('123')).resolves.toBeNull();
  });

  it('propagates a nonzero clipboard process exit', () => {
    expect(() => assertSuccessfulExit('clipboard write', 1)).toThrow(/clipboard write failed.*1/);
    expect(() => assertSuccessfulExit('clipboard write', 0)).not.toThrow();
  });

  it('detects payment visuals, raw secret nodes, and the iOS share sheet for opt-in masks', () => {
    const snap: AxSnapshot = {
      screen: { width: 400, height: 800 },
      elements: [
        {
          id: 'payment-info-sensitive-visual',
          frame: { x: 50, y: 100, width: 300, height: 320 },
        },
        {
          id: 'unexpected-system-node',
          label: 'cashuAthis-is-a-deliberately-long-bearer-token-value',
          frame: { x: 10, y: 500, width: 380, height: 30 },
        },
      ],
    };
    expect(automaticSensitiveMaskFrames(snap)).toEqual([
      { x: 50, y: 100, width: 300, height: 320 },
      { x: 10, y: 500, width: 380, height: 30 },
    ]);

    const shareSheet: AxSnapshot = {
      screen: { width: 400, height: 800 },
      elements: [
        { label: 'Close', frame: { x: 360, y: 20, width: 30, height: 30 } },
        { label: 'AirDrop', frame: { x: 20, y: 400, width: 80, height: 40 } },
        { label: 'Messages', frame: { x: 120, y: 400, width: 80, height: 40 } },
      ],
    };
    expect(automaticSensitiveMaskFrames(shareSheet)).toEqual([
      { x: 0, y: 0, width: 400, height: 800 },
    ]);
    expect(findSimulatorElement(shareSheet, { id: 'native-share-sheet' })).toMatchObject({
      id: 'native-share-sheet',
    });
    expect(findSimulatorElement(shareSheet, { id: 'native-share-dismiss' })).toMatchObject({
      id: 'native-share-dismiss',
      label: 'Close',
    });

    const currentShareSheet: AxSnapshot = {
      screen: { width: 430, height: 932 },
      elements: [
        {
          id: 'activityCollectionView',
          label: '',
          frame: { x: 10, y: 500, width: 410, height: 420 },
        },
        {
          id: 'shareCell',
          label: 'Reminders',
          frame: { x: 30, y: 600, width: 100, height: 100 },
        },
        {
          id: 'shareCell',
          label: 'More',
          frame: { x: 150, y: 600, width: 100, height: 100 },
        },
        {
          id: 'actionGroupCell',
          label: 'Copy',
          frame: { x: 30, y: 750, width: 100, height: 100 },
        },
      ],
    };
    expect(findSimulatorElement(currentShareSheet, { id: 'native-share-sheet' })).toMatchObject({
      id: 'native-share-sheet',
    });
    expect(findSimulatorElement(currentShareSheet, { id: 'native-share-dismiss' })).toEqual({
      id: 'native-share-dismiss',
      label: 'Dismiss native share sheet',
      enabled: true,
      frame: { x: 0, y: 0, width: 430, height: 186.4 },
    });
    expect(automaticSensitiveMaskFrames(currentShareSheet)).toEqual([
      { x: 0, y: 0, width: 430, height: 932 },
    ]);
  });

  it('keeps QA pixels raw by default and blackens them when masking is requested', async () => {
    const input = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const snap: AxSnapshot = {
      screen: { width: 10, height: 10 },
      elements: [
        {
          id: 'payment-info-sensitive-visual',
          frame: { x: 2, y: 2, width: 4, height: 4 },
        },
      ],
    };
    const raw = await maskScreenshotBytes(new Uint8Array(input), snap);
    const rawPixels = await sharp(raw).removeAlpha().raw().toBuffer();
    expect(rawPixels.every((channel) => channel === 255)).toBe(true);

    const output = await maskScreenshotBytes(new Uint8Array(input), snap, [
      'payment-info-sensitive-visual',
    ]);
    const { data, info } = await sharp(output)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): number => data[(y * info.width + x) * info.channels];
    expect(pixel(0, 0)).toBe(255);
    expect(pixel(3, 3)).toBe(0);
    await expect(
      maskScreenshotBytes(new Uint8Array(input), null, ['payment-info-sensitive-visual'])
    ).rejects.toThrow(/without an accessibility snapshot/);
  });

  it('fails closed when the accessibility tree changes across a bitmap capture', async () => {
    const input = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const before = snapshot('wallet');
    const after: AxSnapshot = {
      screen: before.screen,
      elements: [
        {
          id: 'payment-info-sensitive-visual',
          frame: { x: 0, y: 0, width: 400, height: 400 },
        },
      ],
    };

    const output = await maskScreenshotBytes(
      new Uint8Array(input),
      before,
      ['payment-info-sensitive-visual'],
      after
    );
    const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(data.every((channel) => channel === 0)).toBe(true);
  });

  it('keeps evidence when only non-sensitive native AX identity changes', async () => {
    const input = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const before: AxSnapshot = {
      screen: { width: 400, height: 800 },
      elements: [
        {
          id: 'native-generated-a',
          label: 'Wallet',
          frame: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
    };
    const after: AxSnapshot = {
      screen: before.screen,
      elements: [{ ...before.elements[0]!, id: 'native-generated-b' }],
    };

    const output = await maskScreenshotBytes(new Uint8Array(input), before, [], after);
    const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(data.every((channel) => channel === 255)).toBe(true);
  });

  it('brackets the raw frame with AX snapshots inside private temporary storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-shot-driver-test-'));
    const input = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const snapshots: AxSnapshot[] = [
      snapshot('wallet'),
      {
        screen: { width: 400, height: 800 },
        elements: [
          {
            id: 'payment-info-sensitive-visual',
            frame: { x: 0, y: 0, width: 400, height: 400 },
          },
        ],
      },
    ];
    try {
      const driver = new SimulatorDriver(
        { udid: 'offline-test', axEndpoint: 'unused', touchEndpoint: 'unused' },
        {
          captureAxSnapshot: async () => snapshots.shift()!,
          captureRawScreenshot: async (path) => {
            expect(statSync(path).mode & 0o777).toBe(0o600);
            expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
            writeFileSync(path, input);
          },
          screenshotSettleMs: 0,
          screenshotTempRoot: root,
        }
      );

      const output = await driver.screenshot();
      const { data } = await sharp(output)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      expect(data.every((channel) => channel === 255)).toBe(true);
      expect(snapshots).toHaveLength(0);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
