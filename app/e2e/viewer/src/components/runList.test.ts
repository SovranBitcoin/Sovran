import { afterEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { CatalogRunRef, ScenarioCatalogEntry } from '../../lib/types';
import { parseFacets } from '../../../schema/facets';
import { state } from '../state';
import { renderRunList } from './runList';

const run = (over: Partial<CatalogRunRef> = {}): CatalogRunRef => ({
  runId: 'run-example',
  label: 'example',
  commitRun: false,
  startedAt: '',
  status: 'complete',
  proof: 'product-run',
  driver: 'sim',
  ok: true,
  ...over,
});
const entry = (id: string, runs: CatalogRunRef[]): ScenarioCatalogEntry => ({
  id,
  name: id,
  description: '',
  lane: 'simulator',
  tags: [],
  facets: parseFacets([]),
  platforms: ['ios'],
  suites: [],
  runs,
});
afterEach(() => {
  state.catalog = [];
  state.selectedScenarioId = undefined;
  state.selectedRunId = undefined;
  state.collapsedFlows = [];
});

test('results navigation omits empty and smoke-only definitions while keeping recorded and queued evidence', () => {
  const dom = new JSDOM('<div id="runs"></div>');
  const root = dom.window.document.getElementById('runs');
  if (!root) throw new Error('Missing navigation root');
  state.catalog = [
    { ...entry('empty-legacy', []), facets: parseFacets(['flow:onboarding']) },
    {
      ...entry('smoke-only', [run({ proof: 'orchestration-smoke' })]),
      facets: parseFacets(['flow:onboarding']),
    },
    entry('recorded-legacy', [run({ ok: false })]),
    entry('story:new', [run()]),
    entry('review:manual', [run({ proof: 'manual-review', ok: undefined })]),
    entry('queued', [run({ status: 'in-progress', scenarioStatus: 'pending', ok: undefined })]),
  ];
  renderRunList(root);
  expect(
    [...root.querySelectorAll('.run-row')].map((row) => row.getAttribute('data-scenario'))
  ).toEqual(['recorded-legacy', 'story:new', 'review:manual', 'queued']);
  expect(root.textContent).not.toContain('empty-legacy');
  expect(root.textContent).not.toContain('smoke-only');
  expect(root.querySelector('[data-flow=onboarding]')).toBeNull();
  expect(root.querySelector('.tree-group .badge')?.textContent).toBe('4');
  dom.window.close();
});

test('a history with no evidence shows one empty-state message and no dead navigation rows', () => {
  const dom = new JSDOM('<div id="runs"></div>');
  const root = dom.window.document.getElementById('runs');
  if (!root) throw new Error('Missing navigation root');
  state.catalog = [entry('empty-legacy', [])];
  renderRunList(root);
  expect(root.querySelectorAll('[data-scenario]').length).toBe(0);
  expect(root.querySelectorAll('.tree-group').length).toBe(0);
  expect(root.textContent).toContain('No recorded results yet');
  dom.window.close();
});
