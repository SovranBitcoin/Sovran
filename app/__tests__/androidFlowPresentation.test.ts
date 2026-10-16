import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { androidFlowPresentation } from '@/config/androidFlowPresentation';

const ROUTES = join(__dirname, '..', 'app');

describe('Android flow presentation', () => {
  it('pushes the multi-step money flows instead of sheeting them', () => {
    // A drag-to-dismiss sheet over a scrolling payment flow lets a downward
    // fling throw the payment away; these are screens, left with Back.
    for (const flow of ['(send-flow)', '(receive-flow)', '(transactions-flow)', '(mint-flow)']) {
      expect([flow, androidFlowPresentation(flow)]).toEqual([flow, 'screen']);
    }
  });

  it('keeps the short pick-and-leave surfaces as sheets', () => {
    expect(androidFlowPresentation('(filter-flow)')).toBe('sheet');
    expect(androidFlowPresentation('(prompt-flow)')).toBe('sheet');
  });

  it('has every flow layout name its own route group, so root and chrome agree', () => {
    const layouts = readdirSync(ROUTES)
      .filter((name) => /^\(.+-flow\)$/.test(name))
      .map((group) => ({ group, source: readFileSync(join(ROUTES, group, '_layout.tsx'), 'utf8') }))
      .filter(({ source }) => source.includes('<AndroidSheetFlowStack'));

    expect(layouts.length).toBeGreaterThan(5);
    for (const { group, source } of layouts) {
      expect([group, source.includes(`<AndroidSheetFlowStack flow="${group}">`)]).toEqual([
        group,
        true,
      ]);
    }
  });
});
