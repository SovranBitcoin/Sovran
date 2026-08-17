/**
 * Non-secret e2e contract for selecting a row rendered in an iOS
 * FullWindowOverlay. The row itself is absent from the main AX tree, so the
 * app mirrors its measured centre through the stable row testID's AX value.
 * Drivers parse only this exact prefix and reject off-screen coordinates.
 */
const E2E_ACTION_MENU_TARGET_PREFIX = 'e2e-action-menu-target:';

interface E2EActionMenuTarget {
  x: number;
  y: number;
}

export function serializeE2EActionMenuTarget(target: E2EActionMenuTarget): string {
  return `${E2E_ACTION_MENU_TARGET_PREFIX}${target.x.toFixed(3)}:${target.y.toFixed(3)}`;
}

export function parseE2EActionMenuTarget(value: string | undefined): E2EActionMenuTarget | null {
  if (!value?.startsWith(E2E_ACTION_MENU_TARGET_PREFIX)) return null;
  const fields = value.slice(E2E_ACTION_MENU_TARGET_PREFIX.length).split(':');
  if (fields.length !== 2) return null;
  const x = Number(fields[0]);
  const y = Number(fields[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  return { x, y };
}
