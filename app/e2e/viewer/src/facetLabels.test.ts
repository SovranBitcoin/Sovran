import { describe, expect, it } from 'bun:test';

import { PLATFORMS } from '../../schema/capabilities';
import { FACETS, type FacetName } from '../../schema/facets';
import { FACET_VALUE_LABELS, PLATFORM_LABELS, facetTagLabel, flowGroupLabel } from './facetLabels';

describe('facet display labels', () => {
  it('covers every facet value in FACETS — new vocabulary must ship a label', () => {
    for (const [facet, values] of Object.entries(FACETS) as [FacetName, readonly string[]][]) {
      for (const value of values) {
        expect(
          `${facet}:${value} → ${FACET_VALUE_LABELS[facet][value] ?? 'MISSING'}`
        ).not.toContain('MISSING');
      }
    }
  });

  it('has no stale labels for values FACETS no longer knows', () => {
    for (const [facet, labels] of Object.entries(FACET_VALUE_LABELS) as [
      FacetName,
      Record<string, string>,
    ][]) {
      for (const value of Object.keys(labels)) {
        expect(FACETS[facet] as readonly string[]).toContain(value);
      }
    }
  });

  it('covers every platform', () => {
    for (const platform of PLATFORMS) {
      expect(typeof PLATFORM_LABELS[platform]).toBe('string');
    }
  });

  it('falls back to the raw tag for historical/unknown tags', () => {
    expect(facetTagLabel('legacy-derived')).toBe('legacy-derived');
    expect(facetTagLabel('flow:nonexistent')).toBe('flow:nonexistent');
    expect(facetTagLabel('instrument:bolt11')).toBe('Lightning invoice');
  });

  it('labels flow groups including the untagged bucket', () => {
    expect(flowGroupLabel('history')).toBe('Transaction history');
    expect(flowGroupLabel('untagged')).toBe('Untagged');
  });
});
