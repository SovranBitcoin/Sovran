import { describe, expect, it } from 'bun:test';

import { parseE2EActionMenuTarget, serializeE2EActionMenuTarget } from './actionMenuTarget';

describe('e2e action-menu target contract', () => {
  it('round-trips finite non-secret screen coordinates', () => {
    const serialized = serializeE2EActionMenuTarget({ x: 196.25, y: 713.875 });
    expect(serialized).toBe('e2e-action-menu-target:196.250:713.875');
    expect(parseE2EActionMenuTarget(serialized)).toEqual({ x: 196.25, y: 713.875 });
  });

  it('rejects unrelated, malformed, and negative values', () => {
    expect(parseE2EActionMenuTarget(undefined)).toBeNull();
    expect(parseE2EActionMenuTarget('196:714')).toBeNull();
    expect(parseE2EActionMenuTarget('e2e-action-menu-target:196')).toBeNull();
    expect(parseE2EActionMenuTarget('e2e-action-menu-target:-1:714')).toBeNull();
  });
});
