/**
 * Plays a story against the app (ADR 0033): mark the step in the app's log,
 * issue its one action, wait for the app to report its screen still, then wait
 * until everything the step expects is true. Nothing is repeated and nothing
 * waits on a duration; a step that is not satisfied by its deadline fails and
 * says what the screen and the log held.
 */
import type { AppLink, AppLogEntry, AppScreen } from '../link/appLink';
import type { Selector } from '../schema/selectors';
import type { Expectation, Step, Story } from './story';

type Element = AppScreen['elements'][number];

/** The app is given at least this long to answer, however little of the step is left. */
const ANSWER_WITHIN_MS = 2000;
/** An answer slower than this means touches were not being handled either. */
const SLOW_ANSWER_MS = 250;
/**
 * After a swipe the picture must be unchanged for this long. A list that has
 * been dragged past its end springs back with a tail the eye cannot see, and
 * until it ends iOS spends the next tap on stopping the list.
 */
const STILL_AFTER_SWIPE_MS = 400;
/** A list springing back on a busy machine was seen still moving after 900 ms; it is given this long. */
const SWIPE_SETTLES_WITHIN_MS = 3000;
/** Which way the finger moves, as steps across and down the screen. */
const SWIPES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/** The one thing a device does for a story: touch the glass. */
/** Says when the picture on screen has stopped changing. */
interface PixelWatch {
  /** `stillForMs`: how long the picture must not change; the watch's own default when left out. */
  pixelsStill(
    stillForMs?: number,
    giveUpAfterMs?: number
  ): Promise<{ movedForMs: number; stillMoving: boolean }>;
}

export interface TouchDevice {
  /** A tap at a point given as fractions of the window's width and height. */
  tap(x: number, y: number): Promise<void>;
  /** A finger dragged from one point to another and lifted, in the same fractions. */
  swipe(from: [x: number, y: number], to: [x: number, y: number]): Promise<void>;
  /** Text typed on the keyboard, a key at a time. */
  type(text: string): Promise<void>;
  /**
   * Where a control iOS itself drew is, by its label, as fractions of the
   * window; null when there is none.
   */
  findSystemControl?(
    label: string
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;
}

interface StepResult {
  name: string;
  ok: boolean;
  /** App clock at the step's mark and when it was satisfied (or gave up). */
  startedAtAppMs: number;
  endedAtAppMs: number;
  /** Wall time the step took. */
  wallMs: number;
  /** Wall clock when the step was satisfied or gave up, for finding it in the video. */
  endedAtWallMs: number;
  /** How long the screen went on changing after the step's expectations held. */
  screenMovedMs?: number;
  /** True when the screen never stopped changing: something on it animates for ever. */
  screenKeptMoving?: true;
  /** The longest the app took to answer the runner, when long enough that a person would feel it. */
  appUnresponsiveMs?: number;
  /** The entries the app logged during the step. */
  entries: AppLogEntry[];
  failure?: string;
}

interface StoryResult {
  id: string;
  ok: boolean;
  steps: StepResult[];
}

function matches(selector: Selector, element: Element): boolean {
  if ('id' in selector) return element.id === selector.id;
  if ('idPrefix' in selector) return element.id?.startsWith(selector.idPrefix) === true;
  return element.label === selector.label || element.text === selector.label;
}

/**
 * The element a person would act on: the last match in tree order, since a
 * page pushed later is drawn over the ones before it. `matchIndex` picks among
 * the matches on that same page instead.
 */
export function find(selector: Selector, screen: AppScreen): Element | null {
  const all = screen.elements.filter(
    (element) => matches(selector, element) && element.width > 0 && element.height > 0
  );
  if (all.length === 0) return null;
  if ('idPrefix' in selector && selector.matchIndex !== undefined) {
    const page = all[all.length - 1].page;
    return all.filter((element) => element.page === page)[selector.matchIndex] ?? null;
  }
  return all[all.length - 1];
}

/** `name` of the page drawn on top: the last one that has an element laid out. */
export function topPage(screen: AppScreen): string | null {
  for (let index = screen.elements.length - 1; index >= 0; index--) {
    const page = screen.elements[index].page;
    if (page) return page;
  }
  return null;
}

const describeSelector = (selector: Selector) => JSON.stringify(selector);

/** Null when the expectation holds, otherwise what is wrong. */
function unmet(expectation: Expectation, screen: AppScreen, entries: AppLogEntry[]): string | null {
  if ('visible' in expectation)
    return find(expectation.visible, screen)
      ? null
      : `${describeSelector(expectation.visible)} is not on screen`;
  if ('gone' in expectation)
    return find(expectation.gone, screen)
      ? `${describeSelector(expectation.gone)} is still on screen`
      : null;
  if ('page' in expectation) {
    const top = topPage(screen);
    return top === expectation.page
      ? null
      : `the page on top is ${top ?? 'unknown'}, not ${expectation.page}`;
  }
  const wanted = Object.entries(expectation.with ?? {});
  const found = entries.some(
    (entry) =>
      entry.event === expectation.logged &&
      wanted.every(([key, value]) => entry.params?.[key] === value)
  );
  return found
    ? null
    : `the app did not log ${expectation.logged}${wanted.length ? ` with ${JSON.stringify(expectation.with)}` : ''}`;
}

/** Past a step's deadline, how long a screen that is still moving is given to stop. */
const STILL_GRACE_MS = 3500;

async function playStep(
  step: Step,
  index: number,
  link: AppLink,
  device: TouchDevice,
  pixels: PixelWatch | undefined
): Promise<StepResult> {
  const startedWall = performance.now();
  const label = `${index + 1}-${step.name}`;
  const mark = await link.mark(label);
  const from = link.entries.indexOf(mark) + 1;
  const deadline = startedWall + step.withinMs;
  let motion: { movedForMs: number; stillMoving: boolean } | undefined;
  // The app answers from its JavaScript thread, so a slow answer is that thread
  // busy with something else. It is given until the step's deadline, and the
  // longest it kept the runner waiting is reported.
  let slowestAnswerMs = 0;
  const readScreen = async () => {
    const asked = performance.now();
    try {
      return await link.screen(Math.max(ANSWER_WITHIN_MS, deadline - asked));
    } finally {
      slowestAnswerMs = Math.max(slowestAnswerMs, Math.round(performance.now() - asked));
    }
  };
  const finish = (failure?: string): StepResult => {
    const entries = link.entries.slice(from);
    return {
      name: step.name,
      ok: failure === undefined,
      ...(motion ? { screenMovedMs: motion.movedForMs } : {}),
      ...(motion?.stillMoving ? { screenKeptMoving: true as const } : {}),
      ...(slowestAnswerMs >= SLOW_ANSWER_MS ? { appUnresponsiveMs: slowestAnswerMs } : {}),
      startedAtAppMs: mark._t,
      endedAtAppMs: entries.at(-1)?._t ?? mark._t,
      wallMs: Math.round(performance.now() - startedWall),
      endedAtWallMs: Date.now(),
      entries,
      ...(failure === undefined ? {} : { failure }),
    };
  };

  try {
    if (step.tap) {
      // A page that began to slide after the last step ended is still moving
      // under the finger; a tap then lands on nothing, or on what was there before.
      await pixels?.pixelsStill();
      const screen = await readScreen();
      const inApp = find(step.tap, screen);
      // What iOS draws itself (a menu, an alert) is not in the app's map; the
      // simulator knows it by its label, at most of a second per look.
      type Placed = { x: number; y: number; width: number; height: number } | null;
      let outside = null as Placed;
      if (!inApp && 'label' in step.tap && device.findSystemControl) {
        // A menu iOS is still opening is not there on the first look. This is the
        // one place the runner looks again: nothing has been touched yet.
        // It is also still moving as it opens: it is tapped once two looks agree on where it is.
        let before = null as Placed;
        do {
          before = outside;
          outside = await device.findSystemControl(step.tap.label);
        } while (
          (!outside || !before || before.x !== outside.x || before.y !== outside.y) &&
          performance.now() < deadline
        );
      }
      if (!inApp && !outside)
        return finish(`Nothing to tap: ${describeSelector(step.tap)} is not on screen`);
      if (inApp?.disabled)
        return finish(`Cannot tap ${describeSelector(step.tap)}: it is disabled`);
      const [across, down] = step.tapAt ?? [0.5, 0.5];
      if (inApp)
        await device.tap(
          (inApp.x + inApp.width * across) / screen.width,
          (inApp.y + inApp.height * down) / screen.height
        );
      else if (outside)
        await device.tap(outside.x + outside.width * across, outside.y + outside.height * down);
    }
    if (step.swipe) {
      const screen = await readScreen();
      const target = find(step.swipe.on, screen);
      if (!target)
        return finish(`Nothing to swipe: ${describeSelector(step.swipe.on)} is not on screen`);
      const from: [number, number] = [
        (target.x + target.width / 2) / screen.width,
        (target.y + target.height / 2) / screen.height,
      ];
      const [across, down] = SWIPES[step.swipe.direction];
      const clamp = (fraction: number) => Math.min(0.98, Math.max(0.02, fraction));
      await device.swipe(from, [
        clamp(from[0] + across * step.swipe.distance),
        clamp(from[1] + down * step.swipe.distance),
      ]);
    }
    if (step.type) {
      if (step.type.into) {
        const screen = await readScreen();
        const target = find(step.type.into, screen);
        if (!target)
          return finish(
            `Nothing to type into: ${describeSelector(step.type.into)} is not on screen`
          );
        await device.tap(
          (target.x + target.width / 2) / screen.width,
          (target.y + target.height / 2) / screen.height
        );
        // The field has to take the cursor before the first key arrives.
        await link.mark(`${label}:focused`);
        await link.still(Math.max(1, deadline - performance.now()) + STILL_GRACE_MS);
      }
      await device.type(step.type.enter ? `${step.type.text}\n` : step.type.text);
    }
    // A second mark, sent after the touch: the app treats a mark as something
    // happening on screen, so "still" is then judged from a moment by which it
    // certainly had the touch.
    await link.mark(`${label}:sent`);

    for (;;) {
      await link.still(Math.max(1, deadline - performance.now()) + STILL_GRACE_MS);
      const screen = await readScreen();
      const entries = link.entries.slice(from);
      const problems = step.expect
        .map((expectation) => unmet(expectation, screen, entries))
        .filter((problem): problem is string => problem !== null);
      if (problems.length === 0) {
        // The app is still and says what was expected; the eye may not agree
        // yet. An animation off the JavaScript thread shows only in the pixels.
        motion = step.swipe
          ? await pixels?.pixelsStill(STILL_AFTER_SWIPE_MS, SWIPE_SETTLES_WITHIN_MS)
          : await pixels?.pixelsStill();
        return finish();
      }
      const left = deadline - performance.now();
      if (left <= 0)
        return finish(
          `${problems.join('; ')}. On screen: ${screen.elements
            .filter((element) => element.id)
            .slice(-12)
            .map((element) => element.id)
            .join(', ')}`
        );
      // Wait for the app to do something more, not for time to pass.
      await link
        .waitFor(() => true, {
          timeoutMs: left,
          from: link.entries.length,
          what: 'the app to log anything',
        })
        .catch(() => undefined);
    }
  } catch (error) {
    return finish(error instanceof Error ? error.message : String(error));
  }
}

/** Play the steps in order, stopping at the first that fails. */
export async function playStory(
  story: Story,
  link: AppLink,
  device: TouchDevice,
  pixels?: PixelWatch,
  /** Called as each step ends, pass or fail; the next begins when it resolves. */
  afterStep?: (index: number, step: StepResult) => Promise<void>
): Promise<StoryResult> {
  const steps: StepResult[] = [];
  for (const [index, step] of story.steps.entries()) {
    const result = await playStep(step, index, link, device, pixels);
    steps.push(result);
    await afterStep?.(index, result);
    if (!result.ok) break;
  }
  return { id: story.id, ok: steps.every((step) => step.ok), steps };
}
