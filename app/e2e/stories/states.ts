/**
 * The states a story can start from (ADR 0033). `fresh` is an app never
 * opened. Every other state is where another story ends, one kept in `states/`
 * because it only sets things up, or any story in `library/`: that story is
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

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where a starting state's story is looked for: the set-up stories first, then the stories themselves. */
const STORY_DIRS = [join(HERE, 'states'), join(HERE, 'library')];

interface StateStory {
  story: Story;
  /** Identifies this story and every state before it; a saved state made from anything else is stale. */
  madeFrom: string;
}

/** The story that builds a state, read from `states/<name>.json`. */
export function stateStory(name: string, dirs = STORY_DIRS, seen: string[] = []): StateStory {
  if (seen.includes(name))
    throw new Error(`States start from each other in a circle: ${[...seen, name].join(' → ')}.`);
  const file = dirs.map((dir) => join(dir, `${name}.json`)).find((path) => existsSync(path));
  if (!file)
    throw new Error(
      `No story builds the state "${name}": there is no ${name}.json in ${dirs.join(' or ')}.`
    );
  const text = readFileSync(file, 'utf8');
  const story = storySchema.parse(JSON.parse(text));
  if (story.id !== name) throw new Error(`${file} builds "${story.id}", not "${name}".`);
  return { story, madeFrom: madeFrom(story, text, dirs, [...seen, name]) };
}

/** What identifies the state a story ends in: the story as written, and every state before it. */
export function madeFrom(
  story: Story,
  text: string,
  dirs = STORY_DIRS,
  seen: string[] = []
): string {
  const before =
    story.startsFrom === FRESH ? '' : stateStory(story.startsFrom, dirs, seen).madeFrom;
  return createHash('sha256').update(before).update(text).digest('hex');
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
  dirs = STORY_DIRS
): Promise<void> {
  if (name === FRESH) return actions.startFrom(FRESH);
  const { story, madeFrom } = stateStory(name, dirs);
  if (!actions.hasState(name, madeFrom)) {
    await reachState(story.startsFrom, actions, dirs);
    if (!(await actions.play(story)))
      throw new Error(`The state "${name}" could not be built: its story failed.`);
    await actions.saveState(name, madeFrom);
  }
  await actions.startFrom(name);
}
