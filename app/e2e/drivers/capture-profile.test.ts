import { describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import {
  assertCaptureResolution,
  captureEnvironment,
  inspectIosCaptureResolution,
} from './capture-profile';
import { DRIVER_CAPS, scenarioPlatforms } from '../schema/capabilities';

describe('explicit native capture context', () => {
  it('leaves normal defaults untouched and validates profile/campaign identifiers', () => {
    expect(captureEnvironment({})).toEqual({});
    expect(
      captureEnvironment({
        E2E_CAPTURE_PROFILE: 'library-v1',
        E2E_CAPTURE_CAMPAIGN_ID: 'press-2026_child01',
      })
    ).toEqual({ captureProfile: 'library-v1', captureCampaignId: 'press-2026_child01' });
    for (const profile of ['', 'library-v2', ' library-v1'])
      expect(() => captureEnvironment({ E2E_CAPTURE_PROFILE: profile })).toThrow(
        /E2E_CAPTURE_PROFILE/
      );
    for (const campaign of ['', '../other', 'with space', 'x\ny', 'x'.repeat(81)])
      expect(() => captureEnvironment({ E2E_CAPTURE_CAMPAIGN_ID: campaign })).toThrow(
        /E2E_CAPTURE_CAMPAIGN_ID/
      );
  });

  it('rejects suite-sized or rotated rasters rather than resizing evidence', () => {
    expect(() => assertCaptureResolution('ios', { width: 1320, height: 2868 })).not.toThrow();
    expect(() => assertCaptureResolution('android', { width: 1080, height: 2400 })).not.toThrow();
    expect(() => assertCaptureResolution('android', { width: 1080, height: 1920 })).toThrow(
      /requires 1080x2400/
    );
    expect(() => assertCaptureResolution('ios', { width: 2868, height: 1320 })).toThrow(
      /requires 1320x2868/
    );
  });

  it.each([true, false])(
    'removes private preflight pixels on dimension success=%s',
    async (valid) => {
      const png = await sharp({
        create: {
          width: valid ? 1320 : 10,
          height: valid ? 2868 : 10,
          channels: 3,
          background: 'black',
        },
      })
        .png()
        .toBuffer();
      let directory = '';
      const inspecting = inspectIosCaptureResolution('owned-device', async (args, options) => {
        expect(args.slice(0, 5)).toEqual(['xcrun', 'simctl', 'io', 'owned-device', 'screenshot']);
        expect(options?.timeoutMs).toBe(30_000);
        directory = dirname(args.at(-1)!);
        writeFileSync(args.at(-1)!, png);
        return '';
      });
      if (valid) await expect(inspecting).resolves.toEqual({ width: 1320, height: 2868 });
      else await expect(inspecting).rejects.toThrow(/requires/);
      expect(existsSync(directory)).toBe(false);
    }
  );

  it('does not advertise Android permission reset or the incomplete GPS set/clear contract', () => {
    for (const capability of ['device.location', 'device.permission-reset']) {
      expect(DRIVER_CAPS.android.has(capability)).toBe(false);
      expect(scenarioPlatforms([capability])).toEqual(['ios']);
    }
  });
});
