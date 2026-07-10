/**
 * @jest-environment node
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface CameraFixture {
  id: string;
  image: string;
  payload: string;
  imageSha256: string;
  payloadSha256: string;
  expectedClassifier: string;
  payable: false;
}

interface CameraManifest {
  version: 1;
  fixtures: CameraFixture[];
}

const SERVE_SIM_ROOT = path.resolve(process.cwd(), 'scripts/serve-sim');
const manifest = JSON.parse(
  readFileSync(path.join(SERVE_SIM_ROOT, 'manifest.json'), 'utf8')
) as CameraManifest;

function fixturePath(relativePath: string): string {
  const resolved = path.resolve(SERVE_SIM_ROOT, relativePath);
  const fixtureRoot = `${path.join(SERVE_SIM_ROOT, 'fixtures')}${path.sep}`;
  if (!resolved.startsWith(fixtureRoot)) {
    throw new Error(`serve-sim fixture escapes fixtures/: ${relativePath}`);
  }
  return resolved;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('serve-sim tracked fixture manifest', () => {
  it('has one stable id per explicitly non-payable fixture', () => {
    expect(manifest.version).toBe(1);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(
      manifest.fixtures.length
    );
    manifest.fixtures.forEach((fixture) => {
      expect(fixture.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(fixture.payable).toBe(false);
      expect(fixture.expectedClassifier.length).toBeGreaterThan(0);
    });
  });

  it('keeps every payload and image inside fixtures/ and pins their bytes', () => {
    manifest.fixtures.forEach((fixture) => {
      expect(sha256(fixturePath(fixture.image))).toBe(fixture.imageSha256);
      expect(sha256(fixturePath(fixture.payload))).toBe(fixture.payloadSha256);
    });
  });
});
