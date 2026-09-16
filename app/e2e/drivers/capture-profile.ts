import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { RunOptions } from './simctl';

/** Explicit presentation contract shared by native drivers, never suite-derived. */
export const LIBRARY_CAPTURE_PROFILE = {
  id: 'library-v1',
  ios: {
    model: 'iPhone 17 Pro Max',
    runtime: '26.2',
    resolution: { width: 1320, height: 2868 },
    density: { scale: 3 },
  },
  android: {
    model: 'pixel_7_pro',
    systemImage: 'system-images/android-36.1/google_apis_playstore/arm64-v8a',
    resolution: { width: 1080, height: 2400 },
    density: { dpi: 420 },
    // Animations are disabled for Android capture. `uiautomator dump` waits for
    // the window to go idle, and a looping animation (a skeleton shimmer, a
    // marquee) never lets it, so the dump is reaped and the harness sees an
    // empty screen it cannot act on. A still library frame wants the settled
    // state anyway; iOS reads its hierarchy directly and keeps system motion.
    motion: 'reduced',
  },
  locale: 'en-US',
  appearance: 'light',
  fontScale: 1,
} as const;

export type CaptureProfile = typeof LIBRARY_CAPTURE_PROFILE.id;

export interface NativeCaptureMetadata {
  profile: CaptureProfile;
  model: string;
  runtime: string;
  runtimeBuild?: string;
  systemImage?: string;
  resolution: { width: number; height: number };
  density: { dpi?: number; scale?: number };
  locale: string;
  appearance: string;
  fontScale: number;
  /** Android capture only: animations are disabled so the window can go idle. */
  motion?: 'reduced';
}

/** Private, pre-install raster probe. Always remove it, including on mismatch. */
export async function inspectIosCaptureResolution(
  udid: string,
  execute: (args: string[], options?: RunOptions) => Promise<string>,
  signal?: AbortSignal
): Promise<{ width: number; height: number }> {
  const directory = mkdtempSync(join(tmpdir(), 'sovran-e2e-display-'));
  try {
    const path = join(directory, 'display.png');
    await execute(['xcrun', 'simctl', 'io', udid, 'screenshot', '--type', 'png', path], {
      signal,
      timeoutMs: 30_000,
    });
    const { width, height } = await sharp(readFileSync(path)).metadata();
    assertCaptureResolution('ios', { width, height });
    return { width: width!, height: height! };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function captureEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): {
  captureProfile?: CaptureProfile;
  captureCampaignId?: string;
} {
  const profile = env.E2E_CAPTURE_PROFILE;
  const campaign = env.E2E_CAPTURE_CAMPAIGN_ID;
  if (profile !== undefined && profile !== 'library-v1') {
    throw new Error('E2E_CAPTURE_PROFILE must be library-v1 or unset');
  }
  if (campaign !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaign)) {
    throw new Error(
      'E2E_CAPTURE_CAMPAIGN_ID must be 1-80 ASCII letters, digits, underscores or hyphens, starting with a letter or digit'
    );
  }
  return {
    ...(profile ? { captureProfile: profile } : {}),
    ...(campaign ? { captureCampaignId: campaign } : {}),
  };
}

export function assertCaptureResolution(
  platform: 'ios' | 'android',
  actual: { width?: number; height?: number }
): void {
  const expected = LIBRARY_CAPTURE_PROFILE[platform].resolution;
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `library-v1 ${platform} requires ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`
    );
  }
}
