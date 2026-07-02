/**
 * Overflow partitioning for the underline tab bar: all tabs stay visible
 * while every label fits at intrinsic width + padding; otherwise the longest
 * fitting prefix keeps the bar (never fewer than one) and the rest collapse
 * behind the (…) menu button.
 */

import { partitionTabs } from '@/shared/ui/composed/underlineTabsLayout';

// Mirror the component's constants: 12px padding per label side, 48px button.
const w = (widths: Record<string, number>) => widths;

describe('partitionTabs', () => {
  it('keeps everything visible while unmeasured (first frame)', () => {
    expect(partitionTabs(['A', 'B', 'C'], {}, 0)).toEqual({
      visible: ['A', 'B', 'C'],
      overflow: [],
    });
    expect(partitionTabs(['A', 'B'], w({ A: 40 }), 320)).toEqual({
      visible: ['A', 'B'],
      overflow: [],
    });
  });

  it('shows all tabs when the padded labels fit the container', () => {
    // 4 × (50 + 24) = 296 ≤ 320
    const widths = w({ Lightning: 50, Bolt12: 50, Onchain: 50, P2PK: 50 });
    expect(partitionTabs(['Lightning', 'Bolt12', 'Onchain', 'P2PK'], widths, 320)).toEqual({
      visible: ['Lightning', 'Bolt12', 'Onchain', 'P2PK'],
      overflow: [],
    });
  });

  it('collapses the tail behind the menu button when labels overflow', () => {
    // Each padded tab needs 104; container 320 → total 520 > 320.
    // Budget with the 48px button = 272 → two tabs (208) fit, third would not.
    const widths = w({ Lightning: 80, Bolt12: 80, Onchain: 80, P2PK: 80, Nostr: 80 });
    expect(partitionTabs(['Lightning', 'Bolt12', 'Onchain', 'P2PK', 'Nostr'], widths, 320)).toEqual(
      {
        visible: ['Lightning', 'Bolt12'],
        overflow: ['Onchain', 'P2PK', 'Nostr'],
      }
    );
  });

  it('never collapses below one visible tab', () => {
    const widths = w({ Enormous: 400, Other: 400 });
    expect(partitionTabs(['Enormous', 'Other'], widths, 200)).toEqual({
      visible: ['Enormous'],
      overflow: ['Other'],
    });
  });

  it('is stable at the exact fit boundary', () => {
    // 2 × (100 + 24) = 248 exactly — no overflow at 248, overflow at 247.
    const widths = w({ A: 100, B: 100 });
    expect(partitionTabs(['A', 'B'], widths, 248).overflow).toEqual([]);
    expect(partitionTabs(['A', 'B'], widths, 247).overflow).toEqual(['B']);
  });
});
