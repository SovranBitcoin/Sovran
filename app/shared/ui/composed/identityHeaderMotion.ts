/** Two thresholds prevent a resting scroll offset from repeatedly changing identity. */
export function shouldCollapseIdentity(
  scrollY: number,
  wasCollapsed: boolean,
  collapseAt: number,
  enabled: boolean
): boolean {
  'worklet';
  if (!enabled) return false;
  return wasCollapsed ? scrollY >= Math.max(0, collapseAt - 20) : scrollY > collapseAt;
}
