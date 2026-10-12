/**
 * The states a story can start from (ADR 0033). `fresh` is an app never
 * opened. Every other state is where a story in `states/` ends: that story is
 * played once on a simulator, what it leaves is saved there, and any story
 * that starts from it has it copied back. A state can itself start from
 * another, so `funded` can be `onboarded` plus a deposit.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRESH } from './simulator';
import { storySchema, type Story } from './story';

const STATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'states');

interface StateStory {
  story: Story;
  /** Identifies this story and every state before it; a saved state made from anything else is stale. */
  madeFrom: string;
}

/** The story that builds a state, read from `states/<name>.json`. */
export function stateStory(name: string, dir = STATES_DIR, seen: string[] = []): StateStory {
  if (seen.includes(name))
    throw new Error(`States start from each other in a circle: ${[...seen, name].join(' → ')}.`);
  const file = join(dir, `${name}.json`);
  if (!existsSync(file))
    throw new Error(`No story builds the state "${name}": ${file} does not exist.`);
  const text = readFileSync(file, 'utf8');
  const story = storySchema.parse(JSON.parse(text));
  if (story.id !== name) throw new Error(`${file} builds "${story.id}", not "${name}".`);
  const before =
    story.startsFrom === FRESH ? '' : stateStory(story.startsFrom, dir, [...seen, name]).madeFrom;
  return { story, madeFrom: createHash('sha256').update(before).update(text).digest('hex') };
}

/** What `reachState` needs of a simulator and of the runner. */
export interface StateActions {
  hasState(name: string, madeFrom: string): boolean;
  /** Put the app in a state: `fresh`, or one saved here. */
  startFrom(state: string): Promise<void>;
  /** Play a story from where the app now is; false when it failed. */
  play(story: Story): Promise<boolean>;
  saveState(name: string, madeFrom: string): Promise<void>;
}

/**
 * Leave the app in the named state, building and saving it first (and any
 * state it starts from) if this simulator does not have it yet.
 */
export async function reachState(
  name: string,
  actions: StateActions,
  dir = STATES_DIR
): Promise<void> {
  if (name === FRESH) return actions.startFrom(FRESH);
  const { story, madeFrom } = stateStory(name, dir);
  if (!actions.hasState(name, madeFrom)) {
    await reachState(story.startsFrom, actions, dir);
    if (!(await actions.play(story)))
      throw new Error(`The state "${name}" could not be built: its story failed.`);
    await actions.saveState(name, madeFrom);
  }
  await actions.startFrom(name);
}
