// The state space the design-system matrix page draws: every frame, and the
// places where the screen title and the timeline tell different stories.
import { describe, expect, it } from 'vitest';

import { transactionHeaderPhase, transactionHeaderTitle } from '../../src/history/header-title';
import {
  TIMELINE_SPACES,
  describeTimelineSurfaces,
  timelineFrameAppearance,
  walkTimelineSpace,
} from '../../src/history/timeline/space';

describe('timeline state space', () => {
  it('gives every node at least one frame, and each frame an id unique in its flow', () => {
    for (const space of TIMELINE_SPACES) {
      const frames = walkTimelineSpace(space);
      expect(new Set(frames.map((frame) => frame.id)).size, space.flow).toBe(frames.length);
      expect(new Set(frames.map((frame) => frame.node.name)).size, space.flow).toBe(
        space.nodes.length
      );
    }
  });

  it('collapses to the states a person can tell apart', () => {
    const sizes = TIMELINE_SPACES.map((space) => {
      const frames = walkTimelineSpace(space);
      return `${space.flow}: ${frames.length} frames, ${new Set(frames.map(timelineFrameAppearance)).size} appearances`;
    });
    expect(sizes).toMatchInlineSnapshot(`
      [
        "lightning-mint: 36 frames, 11 appearances",
        "onchain-mint: 126 frames, 18 appearances",
        "lightning-melt: 92 frames, 14 appearances",
        "onchain-melt: 170 frames, 19 appearances",
        "send: 13 frames, 7 appearances",
        "locked-send(permanent): 10 frames, 4 appearances",
        "locked-send(timed-refund): 20 frames, 9 appearances",
        "locked-send(timed-public): 20 frames, 9 appearances",
        "locked-send(timed-refund-theirs): 20 frames, 9 appearances",
        "payment-request-send: 31 frames, 10 appearances",
        "receive: 6 frames, 5 appearances",
        "payment-request-receive: 7 frames, 5 appearances",
      ]
    `);
  });

  // A record of what is on screen today, not an endorsement: each line is a
  // state where the title and the last row disagree. Fixing one removes its line.
  it('lists every state whose title and timeline disagree', () => {
    const lines = new Set<string>();
    for (const space of TIMELINE_SPACES) {
      for (const frame of walkTimelineSpace(space)) {
        const surfaces = describeTimelineSurfaces(frame);
        if (!surfaces.disagreement) continue;
        const last = frame.model.steps[frame.model.steps.length - 1];
        lines.add(`${space.flow}: "${surfaces.headerTitle}" over "${last.displayLabel}"`);
      }
    }
    expect([...lines]).toMatchInlineSnapshot(`[]`);
  });

  // The card's label against the timeline under it, by the same rule.
  it('lists every state whose card label and timeline disagree', () => {
    const lines = new Set<string>();
    for (const space of TIMELINE_SPACES) {
      for (const frame of walkTimelineSpace(space)) {
        const surfaces = describeTimelineSurfaces(frame);
        if (!surfaces.cardDisagreement) continue;
        lines.add(`${space.flow}: "${surfaces.cardLabel}" over "${surfaces.statusHeader}"`);
      }
    }
    expect([...lines]).toMatchInlineSnapshot(`
      [
        "lightning-mint: "Receive • Failed" over "INVOICE EXPIRED"",
        "lightning-melt: "Send • Failed" over "QUOTE EXPIRED"",
        "send: "Send • Ready" over "CREATING TOKEN"",
        "payment-request-send: "Payment • Ready" over "CREATING TOKEN"",
        "payment-request-send: "Payment • Ready" over "DELIVERING"",
      ]
    `);
  });

  // The same check for the title read off the entry alone (a caller with no
  // timeline, or the first frame before the timeline reports). Each line is
  // a fact only the timeline's other inputs carry.
  it('lists what the entry alone cannot tell the title', () => {
    const lines = new Set<string>();
    for (const space of TIMELINE_SPACES) {
      for (const frame of walkTimelineSpace(space)) {
        if (!describeTimelineSurfaces(frame).entryOnlyDisagreement) continue;
        const last = frame.model.steps[frame.model.steps.length - 1];
        const title = transactionHeaderTitle(frame.node.input.historyEntry);
        lines.add(`${space.flow}: "${title}" over "${last.displayLabel}"`);
      }
    }
    expect([...lines]).toMatchInlineSnapshot(`
      [
        "lightning-melt: "Send Lightning" over "Quote expired"",
        "onchain-melt: "Sent onchain" over "Paid by the mint"",
        "onchain-melt: "Sent onchain" over "In mempool"",
        "send: "Send ecash" over "Cancelling"",
        "send: "Sending ecash" over "Cancelling"",
        "locked-send(permanent): "Send ecash" over "Cancelling"",
        "locked-send(permanent): "Sending ecash" over "Cancelling"",
        "locked-send(timed-refund): "Send ecash" over "Cancelling"",
        "locked-send(timed-refund): "Sending ecash" over "Cancelling"",
        "locked-send(timed-public): "Send ecash" over "Cancelling"",
        "locked-send(timed-public): "Sending ecash" over "Cancelling"",
        "locked-send(timed-refund-theirs): "Send ecash" over "Cancelling"",
        "locked-send(timed-refund-theirs): "Sending ecash" over "Cancelling"",
      ]
    `);
  });

  it('follows the clock of the timeline, not of the device', () => {
    const mint = TIMELINE_SPACES.find((space) => space.flow === 'lightning-mint')!;
    const unpaid = walkTimelineSpace(mint).find((frame) => frame.node.name === 'UNPAID#0/in-time')!;
    const surfaces = describeTimelineSurfaces(unpaid);
    // The fixture invoice is long past by the device clock, in time by its own.
    expect(transactionHeaderPhase(unpaid.node.input.historyEntry)).toBe('expired');
    expect(surfaces.headerPhase).toBe('ready');
    expect(surfaces.disagreement).toBeNull();
    expect(surfaces.entryOnlyDisagreement).toBeNull();
  });
});
