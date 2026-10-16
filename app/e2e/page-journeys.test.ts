import { describe, expect, it } from 'bun:test';

import { loadE2E } from './core/loader';
import { effectiveRequirements } from './core/plan';
import { scenarioPlatforms } from './schema/capabilities';
import { PAGE_JOURNEY_GAPS } from './schema/page-journey-gaps';
import { CANONICAL_PAGES } from './schema/pages';

const loaded = loadE2E(import.meta.dir);

/** Pages some scenario for the platform names in a screenshot step. */
function pagesWithAJourney(platform: 'ios' | 'android'): Set<string> {
  const pages = new Set<string>();
  for (const scenario of loaded.scenarios.values()) {
    if (!scenarioPlatforms(effectiveRequirements(scenario, loaded.fixtures)).includes(platform)) {
      continue;
    }
    for (const step of [...scenario.steps, ...scenario.verify]) {
      if ('action' in step && step.action === 'screenshot') pages.add(step.name);
    }
  }
  return pages;
}

describe('every page has a journey on both platforms, or says why not', () => {
  const ios = pagesWithAJourney('ios');
  const android = pagesWithAJourney('android');
  const uncovered = CANONICAL_PAGES.filter((page) => !ios.has(page) || !android.has(page));

  it('loads the scenario definitions', () => {
    expect(loaded.issues).toEqual([]);
  });

  it('lists every page that lacks a journey', () => {
    expect(uncovered.filter((page) => !PAGE_JOURNEY_GAPS[page])).toEqual([]);
  });

  it('lists no page that has one', () => {
    expect(
      Object.keys(PAGE_JOURNEY_GAPS).filter((page) => !uncovered.includes(page as never))
    ).toEqual([]);
  });

  it('gives a reason for every capability gap', () => {
    for (const gap of Object.values(PAGE_JOURNEY_GAPS)) {
      if (gap.kind === 'capability') expect(gap.reason.length).toBeGreaterThan(20);
    }
  });
});
