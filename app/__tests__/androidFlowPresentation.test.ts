import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { androidFlowPresentation } from '@/config/androidFlowPresentation';

const ROUTES = join(__dirname, '..', 'app');

describe('Android flow presentation', () => {
  it('pushes the money routes instead of sheeting them', () => {
    // A drag-to-dismiss sheet over a scrolling payment flow lets a downward
    // fling throw the payment away; these are screens, left with Back.
    for (const route of ['transactions', 'lightningSend', 'sendToken', 'backup-intro']) {
      expect([route, androidFlowPresentation(route)]).toEqual([route, 'screen']);
    }
  });

  it('keeps the short pick-and-leave surfaces as sheets', () => {
    for (const route of ['filters', 'cta', 'cta-sample', 'share']) {
      expect([route, androidFlowPresentation(route)]).toEqual([route, 'sheet']);
    }
  });

  it('has exactly the four flow stacks, each built on FlowStack', () => {
    const groups = readdirSync(ROUTES).filter((name) => /^\(.+-flow\)$/.test(name));
    expect(groups.sort()).toEqual([
      '(mint-flow)',
      '(receive-flow)',
      '(send-flow)',
      '(settings-flow)',
    ]);
    for (const group of groups) {
      const source = readFileSync(join(ROUTES, group, '_layout.tsx'), 'utf8');
      expect([group, source.includes('<FlowStack>')]).toEqual([group, true]);
    }
  });
});
