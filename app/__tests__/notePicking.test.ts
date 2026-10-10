/**
 * @jest-environment node
 */

import {
  groupNotes,
  pickCount,
  pickFor,
  pickTotal,
  stepPick,
  stepTotal,
} from '@/features/send/lib/notePicking';

describe('note picking', () => {
  const held = groupNotes([64, 2, 64, 8, 1, 2, 0]);

  it('groups held notes by value, largest first, ignoring empty ones', () => {
    expect(held).toEqual([
      { value: 64, held: 2 },
      { value: 8, held: 1 },
      { value: 2, held: 2 },
      { value: 1, held: 1 },
    ]);
  });

  it('opens on the notes that make an amount the wallet holds exactly', () => {
    const pick = pickFor(held, 74);
    expect(pick).toEqual({ 64: 1, 8: 1, 2: 1 });
    expect(pickTotal(pick)).toBe(74);
    expect(pickCount(pick)).toBe(3);
  });

  it('opens empty on an amount it cannot make, rather than a near miss', () => {
    expect(pickFor(held, 20)).toEqual({});
    expect(pickFor(held, 0)).toEqual({});
  });

  it('finds a set that taking the largest note first would miss', () => {
    const awkward = groupNotes([6, 4, 4]);
    expect(pickFor(awkward, 8)).toEqual({ 4: 2 });
  });

  describe('stepping to the next amount the notes can make', () => {
    const notes = [64, 8, 2];
    const stepHeld = groupNotes(notes);
    // Every amount these three notes can make, in order.
    const sums = [0, 2, 8, 10, 64, 66, 72, 74];
    const nearest = (target: number) => ({
      exactMatch: sums.includes(target),
      lower: [...sums].reverse().find((sum) => sum < target && sum > 0) ?? null,
      upper: sums.find((sum) => sum > target) ?? null,
    });

    it('walks up through every amount and stops at the whole balance', () => {
      const seen = [0];
      let total = 0;
      for (;;) {
        const next = stepTotal(stepHeld, total, 1, nearest);
        if (!next) break;
        expect(pickTotal(next.pick)).toBe(next.total);
        total = next.total;
        seen.push(total);
      }
      expect(seen).toEqual(sums);
    });

    it('walks down to nothing and stops there', () => {
      const seen = [74];
      let total = 74;
      for (;;) {
        const next = stepTotal(stepHeld, total, -1, nearest);
        if (!next) break;
        total = next.total;
        seen.push(total);
      }
      expect(seen).toEqual([...sums].reverse());
    });
  });

  it('never picks more of a note than is held, or fewer than none', () => {
    const [sixtyFour] = held;
    let pick = stepPick({}, sixtyFour!, 1);
    pick = stepPick(pick, sixtyFour!, 1);
    pick = stepPick(pick, sixtyFour!, 1);
    expect(pick).toEqual({ 64: 2 });
    pick = stepPick(stepPick(stepPick(pick, sixtyFour!, -1), sixtyFour!, -1), sixtyFour!, -1);
    expect(pickTotal(pick)).toBe(0);
  });
});
