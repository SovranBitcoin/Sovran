/**
 * @jest-environment node
 */

import {
  MODEL_UNAVAILABLE_TTL_MS,
  isModelUnavailable,
  markModelUnavailable,
  orderByAvailability,
  resetModelAvailability,
} from '@/features/ai/lib/modelAvailability';

jest.mock('@/shared/lib/logger', () => ({
  aiLog: { info: jest.fn(), warn: jest.fn() },
}));

const NODE = 'https://privateprovider.xyz';
const entries = [{ modelId: 'v4-flash' }, { modelId: 'v4-1-flash' }, { modelId: 'glm' }];

beforeEach(() => resetModelAvailability());

describe('what a node has recently refused', () => {
  it('moves a refused model behind the rest without dropping it', () => {
    markModelUnavailable(NODE, 'v4-flash', { status: 404, code: '404' }, 1_000);
    expect(orderByAvailability(NODE, entries, 1_000).map((e) => e.modelId)).toEqual([
      'v4-1-flash',
      'glm',
      'v4-flash',
    ]);
  });

  it('is a fact about one node, not about the model', () => {
    markModelUnavailable(NODE, 'v4-flash', { status: 404 }, 1_000);
    expect(isModelUnavailable('https://ai.redsh1ft.com', 'v4-flash', 1_000)).toBe(false);
    expect(orderByAvailability('https://ai.redsh1ft.com', entries, 1_000)).toEqual(entries);
  });

  it('forgets once the outage has had time to clear', () => {
    markModelUnavailable(NODE, 'v4-flash', { status: 404 }, 1_000);
    expect(isModelUnavailable(NODE, 'v4-flash', 1_000 + MODEL_UNAVAILABLE_TTL_MS)).toBe(true);
    expect(isModelUnavailable(NODE, 'v4-flash', 1_001 + MODEL_UNAVAILABLE_TTL_MS)).toBe(false);
  });

  it('hands back the same array when nothing moved', () => {
    const ordered = orderByAvailability(NODE, entries);
    expect(ordered).toEqual(entries);
  });

  it('records nothing against no node', () => {
    markModelUnavailable(null, 'v4-flash', { status: 404 });
    expect(isModelUnavailable(null, 'v4-flash')).toBe(false);
  });
});
