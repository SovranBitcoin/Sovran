import { shouldCollapseIdentity } from '@/shared/ui/composed/identityHeaderMotion';

it('keeps the current identity through threshold noise and reverses after clearing hysteresis', () => {
  let collapsed = false;
  const states = [0, 76, 77, 75, 76, 57, 56, 55, 70, 80].map((y) => {
    collapsed = shouldCollapseIdentity(y, collapsed, 76, true);
    return collapsed;
  });
  expect(states).toEqual([false, false, true, true, true, true, true, false, false, true]);
});

it('restores the title when the identity disappears and ignores scroll bounce', () => {
  expect(shouldCollapseIdentity(300, true, 76, false)).toBe(false);
  expect(shouldCollapseIdentity(-12, false, 76, true)).toBe(false);
});

it('uses the measured identity boundary for tall headers', () => {
  expect(shouldCollapseIdentity(150, false, 220, true)).toBe(false);
  expect(shouldCollapseIdentity(221, false, 220, true)).toBe(true);
  expect(shouldCollapseIdentity(199, true, 220, true)).toBe(false);
});

it('waits for the measured full profile header before allowing a handoff', () => {
  expect(shouldCollapseIdentity(400, false, Number.POSITIVE_INFINITY, true)).toBe(false);
  const fullHeaderBottom = 350;
  const headerHeight = 104;
  expect(shouldCollapseIdentity(150, false, fullHeaderBottom - headerHeight, true)).toBe(false);
  expect(shouldCollapseIdentity(247, false, fullHeaderBottom - headerHeight, true)).toBe(true);
});
