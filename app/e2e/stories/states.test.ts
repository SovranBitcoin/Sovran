import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reachState, stateStory, type StateActions } from './states';

let dir: string;
const story = (id: string, startsFrom: string, step = 'arrive') =>
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      id,
      purpose: `A person reaches the ${id} state by doing what its story says.`,
      startsFrom,
      steps: [{ name: step, expect: [{ page: 'WalletScreen' }] }],
    })
  );

/** A simulator that remembers what was done to it. */
function simulator(saved: Record<string, string> = {}, failing: string[] = []) {
  const did: string[] = [];
  const actions: StateActions = {
    hasState: (name, madeFrom) => saved[name] === madeFrom,
    startFrom: async (state) => void did.push(`start from ${state}`),
    play: async (played) => {
      did.push(`play ${played.id}`);
      return !failing.includes(played.id);
    },
    saveState: async (name, madeFrom) => {
      did.push(`save ${name}`);
      saved[name] = madeFrom;
    },
  };
  return { actions, did, saved };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-states-'));
  story('onboarded', 'fresh');
  story('funded', 'onboarded');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('reaching the state a story starts from', () => {
  test('fresh needs nothing built', async () => {
    const { actions, did } = simulator();

    await reachState('fresh', actions, [dir]);

    expect(did).toEqual(['start from fresh']);
  });

  test('a state not yet saved is built from the one before it, saved, then started from', async () => {
    const { actions, did } = simulator();

    await reachState('funded', actions, [dir]);

    expect(did).toEqual([
      'start from fresh',
      'play onboarded',
      'save onboarded',
      'start from onboarded',
      'play funded',
      'save funded',
      'start from funded',
    ]);
  });

  test('a state already saved is only copied back', async () => {
    const { actions, did } = simulator();
    await reachState('funded', actions, [dir]);
    did.length = 0;

    await reachState('funded', actions, [dir]);

    expect(did).toEqual(['start from funded']);
  });

  test('changing the story that builds an earlier state rebuilds what was made from it', async () => {
    const { actions, did } = simulator();
    await reachState('funded', actions, [dir]);
    did.length = 0;
    story('onboarded', 'fresh', 'arrive another way');

    await reachState('funded', actions, [dir]);

    expect(did).toContain('play onboarded');
    expect(did).toContain('play funded');
  });

  test('a state whose story fails is not saved, and the story that wanted it does not start', async () => {
    const { actions, did, saved } = simulator({}, ['onboarded']);

    await expect(reachState('funded', actions, [dir])).rejects.toThrow(
      /"onboarded" could not be built/
    );

    expect(saved).toEqual({});
    expect(did).not.toContain('play funded');
  });

  test('a state no story builds is named in the error', () => {
    expect(() => stateStory('two-profiles', [dir])).toThrow(
      /No story builds the state "two-profiles"/
    );
  });

  test('states that start from each other are refused', () => {
    story('onboarded', 'funded');

    expect(() => stateStory('funded', [dir])).toThrow(/in a circle: funded → onboarded → funded/);
  });
});
