// The state space the design-system matrix page draws: every frame, and the
// places where the screen title and the timeline tell different stories.
import { describe, expect, it } from 'vitest';

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
    expect([...lines]).toMatchInlineSnapshot(`
      [
        "lightning-mint: "Receive Lightning" over "Invoice expired"",
        "lightning-mint: "Invoice expired" over "Failed"",
        "lightning-mint: "Received Lightning" over "Not added"",
        "onchain-mint: "Receive onchain" over "Failed"",
        "onchain-mint: "Received onchain" over "Not added"",
        "lightning-melt: "Send Lightning" over "Quote expired"",
        "lightning-melt: "Cancelled payment" over "Cancelling"",
        "lightning-melt: "Lightning send failed" over "Cancelled"",
        "lightning-melt: "Cancelled payment" over "Payment failed"",
        "onchain-melt: "Sent onchain" over "Paid by the mint"",
        "onchain-melt: "Cancelled payment" over "Cancelling"",
        "onchain-melt: "Onchain send failed" over "Cancelled"",
        "onchain-melt: "Cancelled payment" over "Payment failed"",
        "onchain-melt: "Sent onchain" over "In mempool"",
        "send: "Send ecash" over "Cancelling"",
        "send: "Sending ecash" over "Cancelling"",
        "send: "Cancelled ecash" over "Cancelling"",
        "locked-send(permanent): "Send ecash" over "Cancelling"",
        "locked-send(permanent): "Sending ecash" over "Cancelling"",
        "locked-send(permanent): "Cancelled ecash" over "Cancelling"",
        "locked-send(timed-refund): "Send ecash" over "Cancelling"",
        "locked-send(timed-refund): "Sending ecash" over "Cancelling"",
        "locked-send(timed-refund): "Cancelled ecash" over "Cancelling"",
        "locked-send(timed-public): "Send ecash" over "Cancelling"",
        "locked-send(timed-public): "Sending ecash" over "Cancelling"",
        "locked-send(timed-public): "Cancelled ecash" over "Cancelling"",
        "locked-send(timed-refund-theirs): "Send ecash" over "Cancelling"",
        "locked-send(timed-refund-theirs): "Sending ecash" over "Cancelling"",
        "locked-send(timed-refund-theirs): "Cancelled ecash" over "Cancelling"",
        "payment-request-send: "Cancelled ecash" over "Cancelling"",
        "receive: "Received ecash" over "Ready to redeem"",
        "receive: "Cancelled ecash" over "Already spent"",
        "receive: "Cancelled ecash" over "Not added"",
        "payment-request-receive: "Received ecash" over "Adding to wallet"",
        "payment-request-receive: "Cancelled ecash" over "Already spent"",
        "payment-request-receive: "Cancelled ecash" over "Not added"",
      ]
    `);
  });

  it('does not report the device clock as a disagreement', () => {
    const mint = TIMELINE_SPACES.find((space) => space.flow === 'lightning-mint')!;
    const unpaid = walkTimelineSpace(mint).find((frame) => frame.node.name === 'UNPAID#0/in-time')!;
    const surfaces = describeTimelineSurfaces(unpaid);
    // The fixture invoice is long past by the device clock, in time by its own.
    expect(surfaces.headerPhase).toBe('expired');
    expect(surfaces.disagreement).toBeNull();
  });
});
