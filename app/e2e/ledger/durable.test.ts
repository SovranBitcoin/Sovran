import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireDurableLease, ensurePrivateDirectory } from './durable';

describe('durable value-effect lease', () => {
  it('is exclusive, private, and cannot be released by a stale owner', () => {
    const base = mkdtempSync(join(tmpdir(), 'e2e-lease-'));
    const dir = join(base, 'effect-leases');
    const path = join(dir, 'leg.lock');
    ensurePrivateDirectory(dir);
    const first = acquireDurableLease(path, 'owner-one');

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => acquireDurableLease(path, 'owner-two')).toThrow(/already held/);

    // Model explicit operator takeover: the old process must not be able to
    // unlink a replacement owner's fencing token when it resumes.
    unlinkSync(path);
    const replacement = acquireDurableLease(path, 'owner-two');
    expect(() => first.release()).toThrow(/ownership changed/);
    expect(existsSync(path)).toBe(true);

    replacement.release();
    expect(existsSync(path)).toBe(false);
  });
});
