// Brute force over the timeline's whole input space.
//
// The space itself (nodes and edges per flow) lives in
// src/history/timeline/space.ts, shared with the design-system matrix page. The
// walk visits every reachable (node, rows-already-drawn) pair, the way a
// mounted timeline would, and checks the same promises on each:
//
//   • a row, once drawn, is never taken away and never moves;
//   • there is at most one open row and it is the last one;
//   • a row that finishes changes its wording (the tense has to turn);
//   • nothing is blank, duplicated, or unrenderable.

import { describe, expect, it } from 'vitest';

import { buildTimelineModel } from '../../src/history';
import { decodeBolt11Invoice } from '../../src/bolt11';
import type { TimelineModel } from '../../src/history';
import {
  TIMELINE_SPACES,
  TIMELINE_SPACE_INVOICE,
  TIMELINE_SPACE_INVOICE_EXPIRES_AT,
  walkTimelineSpace,
  type TimelineSpace,
} from '../../src/history/timeline/space';

const CREATED_AT = 1_800_000_000_000;

const OPEN = new Set(['current', 'next-pending', 'waiting']);
const DONE = new Set(['complete', 'success']);

function checkFrame(where: string, model: TimelineModel) {
  const { steps } = model;
  expect(steps.length, `${where}: rendered nothing`).toBeGreaterThan(0);
  const keys = steps.map((step) => step.rowKey);
  expect(new Set(keys).size, `${where}: duplicate row ${keys.join(',')}`).toBe(keys.length);
  steps.forEach((step, index) => {
    expect(step.displayLabel.trim(), `${where}: blank label on ${step.rowKey}`).not.toBe('');
    if (step.info !== undefined) {
      expect(step.info.trim(), `${where}: blank info on ${step.rowKey}`).not.toBe('');
    }
    if (index < steps.length - 1) {
      expect(DONE.has(step.stepType), `${where}: ${step.rowKey} is ${step.stepType} above the last row`).toBe(true);
    }
  });
  const last = steps[steps.length - 1];
  expect(model.outcome.kind === 'pending', `${where}: outcome ${model.outcome.kind} vs last row ${last.stepType}`).toBe(
    OPEN.has(last.stepType)
  );
}

function checkTransition(where: string, before: TimelineModel, after: TimelineModel) {
  const beforeKeys = before.steps.map((step) => step.rowKey);
  const afterKeys = after.steps.map((step) => step.rowKey);
  expect(afterKeys.slice(0, beforeKeys.length), `${where}: rows removed or moved`).toEqual(beforeKeys);
  before.steps.forEach((was, index) => {
    const now = after.steps[index];
    if (DONE.has(was.stepType)) {
      expect(DONE.has(now.stepType), `${where}: finished row ${was.rowKey} reopened`).toBe(true);
      // An event keeps its wording for good. A verdict standing in a slot
      // ("Settled off-chain") may be corrected by the event itself turning up
      // ("Broadcast"): that is a different row id in the same slot.
      if (was.id === now.id) {
        expect(now.displayLabel, `${where}: finished row ${was.rowKey} was reworded`).toBe(
          was.displayLabel
        );
      }
    } else if (now.stepType === 'complete' || (now.stepType === 'success' && now.id === was.id)) {
      expect(now.displayLabel, `${where}: ${was.rowKey} finished without changing tense`).not.toBe(
        was.displayLabel
      );
    }
  });
}

/** Every reachable (node, rows-already-drawn) pair, each edge checked once. */
function walk(space: TimelineSpace): { frames: number; transitions: number; visited: Set<string> } {
  let transitions = 0;
  const frames = walkTimelineSpace(space, ({ node, drawn, from, model }) => {
    const where = `${space.flow} ${from ? `${from.name} → ` : ''}${node.name} [drawn: ${drawn.join(',') || '-'}]`;
    checkFrame(where, model);
    // A mounted timeline feeds the model its own answer back on the next
    // render, so that has to be a fixed point: same rows, nothing doubled.
    const again = buildTimelineModel({ ...node.input, doneRowKeys: model.doneRowKeys });
    expect(again, `${where}: not stable when rebuilt from its own rows`).toEqual(model);
    if (from) {
      checkTransition(where, from.model, model);
      transitions += 1;
    }
  });
  return { frames: frames.length, transitions, visited: new Set(frames.map((frame) => frame.node.name)) };
}

const base = { mintUrl: 'https://mint.example.com', unit: 'sat', createdAt: CREATED_AT };
const entry = (fields: Record<string, unknown>) => ({ ...base, updatedAt: CREATED_AT, ...fields }) as never;

/** Registers the walk. Called once per reclaim-gate setting. */
export function defineTimelineBruteForce(setting: string): void {
describe(`timeline — brute force over every state (${setting})`, () => {
  it('the invoice fixture decodes, so the expiry axis is real', () => {
    const decoded = decodeBolt11Invoice(TIMELINE_SPACE_INVOICE);
    expect(((decoded?.timestampSec ?? 0) + (decoded?.expirySec ?? 3600)) * 1000).toBe(TIMELINE_SPACE_INVOICE_EXPIRES_AT);
  });

  it.each(TIMELINE_SPACES.map((space) => [space.flow, space] as const))(
    '%s: rows are only ever added, from every state to every state that can follow',
    (_flow, space) => {
      const result = walk(space);
      // Every node the space declares was actually rendered.
      expect([...result.visited].sort()).toEqual(space.nodes.map((node) => node.name).sort());
      expect(result.transitions).toBeGreaterThan(space.nodes.length);
    }
  );

  it('renders something for a state no flow has heard of, or renders nothing — never throws', () => {
    for (const type of ['mint', 'melt', 'send', 'receive', 'swap']) {
      for (const state of ['init', 'weird', '', 'PENDING', 'needs_attention']) {
        const build = () =>
          buildTimelineModel({
            historyEntry: entry({ id: 'x', type, state, amount: 1, quoteId: 'q', paymentRequest: '' }),
            currentTime: CREATED_AT,
          });
        expect(build, `${type}/${state}`).not.toThrow();
        const model = build();
        if (model.steps.length > 0) checkFrame(`${type}/${state}`, model);
      }
    }
  });
});
}
