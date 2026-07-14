import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatDoc } from '../schema';
import { validateTree } from '../validate';

const scenario = (id: string) => ({
  version: 1,
  id,
  name: id,
  description: id,
  lane: 'simulator',
  tags: ['flow:onboarding'],
  requires: [],
  steps: [{ action: 'goHome' }],
  verify: [{ action: 'assert', that: 'visible', selector: { id: 'wallet-send' } }],
  endState: 'wallet',
});

describe('validateTree', () => {
  it('fails the package validation gate when full omits a discovered scenario', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-validate-'));
    mkdirSync(join(root, 'scenarios'));
    mkdirSync(join(root, 'suites'));
    writeFileSync(join(root, 'scenarios', 'one.json'), formatDoc(scenario('one')));
    writeFileSync(join(root, 'scenarios', 'two.json'), formatDoc(scenario('two')));
    writeFileSync(
      join(root, 'suites', 'full.json'),
      formatDoc({
        version: 1,
        name: 'full',
        scenarios: [
          {
            id: 'one',
            file: 'scenarios/one.json',
            order: 10,
            newInstance: true,
            lane: 'simulator',
            requires: [],
            endState: 'wallet',
          },
        ],
      })
    );

    expect(validateTree(root).issues).toContainEqual(
      expect.objectContaining({
        file: 'suites/full',
        issue: expect.objectContaining({
          message: expect.stringContaining('full suite missing scenario(s): two'),
        }),
      })
    );
  });

  it('rejects duplicate fixture ids instead of silently overwriting the first file', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-validate-'));
    mkdirSync(join(root, 'fixtures'));
    const fixture = {
      version: 1,
      id: 'flow.same',
      params: [],
      requires: [],
      steps: [{ action: 'goHome' }],
    };
    writeFileSync(join(root, 'fixtures', 'a.json'), formatDoc(fixture));
    writeFileSync(join(root, 'fixtures', 'b.json'), formatDoc(fixture));
    expect(validateTree(root).issues).toContainEqual(
      expect.objectContaining({
        file: 'fixtures/b.json',
        issue: expect.objectContaining({ message: 'duplicate fixture id "flow.same"' }),
      })
    );
  });
});
