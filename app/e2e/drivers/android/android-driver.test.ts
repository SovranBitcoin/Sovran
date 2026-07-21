import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';

import type { Adb } from './adb';
import { AndroidDriver } from './android-driver';

const fundedAsset = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
} as const;
const completeSweep = JSON.stringify({
  version: 1,
  phase: 'complete',
  assets: 1,
  checked: 1,
  spent: 1,
  remaining: [{ ...fundedAsset, amount: 0 }],
});

const xmlAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

function axXml(activeWallet: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy rotation="0">
      <node resource-id="root" class="android.view.View" bounds="[0,0][100,200]">
        <node resource-id="tab-wallet" content-desc="Wallet" class="android.view.View" enabled="true" bounds="[40,170][60,200]" />
        <node text="Split" class="android.widget.TextView" enabled="true" bounds="[10,80][30,100]" />
        <node resource-id="e2e-ready-proof-reconciliation" content-desc="${xmlAttribute(completeSweep)}" class="android.view.View" enabled="true" bounds="[0,0][1,1]" />
        ${
          activeWallet
            ? '<node resource-id="wallet-send" content-desc="Send" class="android.view.View" enabled="true" bounds="[50,120][90,150]" />'
            : ''
        }
      </node>
    </hierarchy>`;
}

class WalletTabAdb {
  activeWallet = false;
  taps: { x: number; y: number }[] = [];

  async uiautomatorDumpXml(): Promise<string> {
    return axXml(this.activeWallet);
  }

  async screenSize(): Promise<{ width: number; height: number }> {
    return { width: 100, height: 200 };
  }

  async tap(x: number, y: number): Promise<void> {
    this.taps.push({ x, y });
    this.activeWallet = true;
  }
}

function walletTabDriver() {
  const adb = new WalletTabAdb();
  const driver = new AndroidDriver(
    adb as unknown as Adb,
    { pollMs: 1 },
    {
      install: async () => undefined,
      refreshClearMs: 0,
    }
  );
  return { adb, driver };
}

describe('AndroidDriver Wallet navigation', () => {
  it('actively selects the Wallet tab instead of accepting hidden inactive Wallet AX', async () => {
    const { adb, driver } = walletTabDriver();

    await driver.home();

    expect(adb.taps).toHaveLength(1);
    await expect(driver.find({ id: 'wallet-send' })).resolves.toMatchObject({ id: 'wallet-send' });
  });

  it('selects the Wallet tab before accepting funded reconciliation probes', async () => {
    const { adb, driver } = walletTabDriver();

    await driver.homeAfterFundedSweep([fundedAsset]);

    expect(adb.taps).toHaveLength(1);
    await expect(driver.find({ id: 'wallet-send' })).resolves.toMatchObject({ id: 'wallet-send' });
  });
});

describe('AndroidDriver screenshot safety', () => {
  it('masks a visible mnemonic value by default without obscuring ordinary profile controls', async () => {
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
    const adb = {
      async screencapPng() {
        return new Uint8Array(input);
      },
      async screenSize() {
        return { width: 10, height: 10 };
      },
      async uiautomatorDumpXml() {
        return `<?xml version="1.0" encoding="UTF-8"?>
          <hierarchy rotation="0">
            <node resource-id="root" class="android.view.View" bounds="[0,0][10,10]">
              <node resource-id="profile-secret-value-mnemonic" class="android.widget.EditText" bounds="[2,2][6,6]" />
              <node resource-id="profile-reveal-mnemonic" content-desc="Hide" class="android.view.View" bounds="[7,7][9,9]" />
            </node>
          </hierarchy>`;
      },
    };
    const driver = new AndroidDriver(
      adb as unknown as Adb,
      { pollMs: 1 },
      {
        install: async () => undefined,
        screenshotSettleMs: 0,
      }
    );

    const output = await driver.screenshot();
    const { data, info } = await sharp(output)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): number => data[(y * info.width + x) * info.channels];

    expect(pixel(3, 3)).toBe(0);
    expect(pixel(8, 8)).toBe(255);
  });
});
