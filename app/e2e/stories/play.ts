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

/** A control that is about to be tapped and is not there is looked for again for this long. */
const APPEARS_WITHIN_MS = 2500;
/**
 * Looking for what iOS drew is given this long however short the step: one look
 * takes a second or more with several simulators running, and the first can
 * come back empty.
 */
const SYSTEM_LOOK_WITHIN_MS = 15_000;
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
/** The most swipes a step with `until` makes before it gives up. */
const SWIPES_UNTIL_MAX = 8;
/**
 * The band of the screen, as fractions of its height, that `until` treats as in
 * the open: below a page's header and above a tab bar, on both platforms.
 */
const OPEN_BAND = [0.2, 0.8] as const;
/** Which way the finger moves, as steps across and down the screen. */
const SWIPES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/** The one thing a device does for a story: touch the glass. */
/** Observes whether display samples have become equal; not a continuous-motion measurement. */
interface PixelWatch {
  /** `stillForMs`: how long the picture must not change; the watch's own default when left out. */
  pixelsStill(
    stillForMs?: number,
    giveUpAfterMs?: number
  ): Promise<{ movedForMs: number; stillMoving: boolean }>;
}

/** Makes what a step says the person is handed (`handed`), by the name a later step uses it under. */
type Hand = (what: NonNullable<Step['handed']>) => Promise<Record<string, string>>;

export interface TouchDevice {
  /** A tap at a point given as fractions of the window's width and height. */
  tap(x: number, y: number): Promise<void>;
  /** A finger dragged from one point to another and lifted, in the same fractions. */
  swipe(from: [x: number, y: number], to: [x: number, y: number]): Promise<void>;
  /** Text typed on the keyboard, a key at a time. */
  type(text: string): Promise<void>;
  /** A link opened as another app would open it. */
  open?(url: string): Promise<void>;
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
  /** Time of the last observed sample change after expectations held. See report observation method. */
  screenMovedMs?: number;
  /** Equal samples were not observed within the settling budget. */
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

/** A selector, or the one a tap may also use: a label by its ending. */
type TapSelector = Selector | { labelEnds: string };

function matches(selector: TapSelector, element: Element): boolean {
  if ('labelEnds' in selector)
    return (element.label ?? element.text)?.endsWith(selector.labelEnds) === true;
  if ('id' in selector) return element.id === selector.id;
  if ('idPrefix' in selector) return element.id?.startsWith(selector.idPrefix) === true;
  return element.label === selector.label || element.text === selector.label;
}

/**
 * The element a person would act on: the last match in tree order, since a
 * page pushed later is drawn over the ones before it. `matchIndex` picks among
 * the matches on that same page instead.
 */
export function find(selector: TapSelector, screen: AppScreen): Element | null {
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

const describeSelector = (selector: TapSelector) => JSON.stringify(selector);

/** Null when the expectation holds, otherwise what is wrong. */
function unmet(expectation: Expectation, screen: AppScreen, entries: AppLogEntry[]): string | null {
  if ('enabled' in expectation) {
    const control = find(expectation.enabled, screen);
    if (!control) return `${describeSelector(expectation.enabled)} is not on screen`;
    return control.disabled ? `${describeSelector(expectation.enabled)} is disabled` : null;
  }
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
  written: Step,
  index: number,
  link: AppLink,
  device: TouchDevice,
  pixels: PixelWatch | undefined,
  /** What earlier steps remembered; this one may use it, and add to it. */
  remembered: Map<string, string>,
  hand?: Hand
): Promise<StepResult> {
  const recall = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (mark, name: string) => remembered.get(name) ?? mark);
  const step: Step = !written.tap
    ? written
    : 'labelEnds' in written.tap
      ? { ...written, tap: { labelEnds: recall(written.tap.labelEnds) } }
      : 'label' in written.tap
        ? { ...written, tap: { label: recall(written.tap.label) } }
        : written;
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
  const needsControlMap =
    step.tap ||
    step.swipe ||
    step.type ||
    step.expect.some((expectation) => !('logged' in expectation));
  const readScreen = async () => {
    for (;;) {
      const asked = performance.now();
      let screen: AppScreen;
      try {
        screen = await link.screen(Math.max(ANSWER_WITHIN_MS, deadline - asked));
      } finally {
        slowestAnswerMs = Math.max(slowestAnswerMs, Math.round(performance.now() - asked));
      }
      const covered = screen.elements.some((element) => element.id === 'boot-splash-overlay');
      if (
        !needsControlMap ||
        (!covered &&
          Number.isFinite(screen.width) &&
          screen.width > 0 &&
          Number.isFinite(screen.height) &&
          screen.height > 0)
      )
        return screen;
      if (performance.now() >= deadline)
        throw new Error(
          covered
            ? 'The current splash still covers the app controls'
            : `control map unavailable: ${screen.source ?? 'no measured window'}`
        );
      // Capture may not have a mounted root during startup. Observe again,
      // without treating missing instrumentation or covered controls as proof
      // that a control is gone. A previous splash.gone log cannot settle a remount.
      await new Promise((resolve) => setTimeout(resolve, 100));
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

  /**
   * Find a control the step is about to act on. One that is out of the app's
   * tree for a moment, while its page draws again, is looked for again for a
   * short while; looking touches nothing.
   */
  const lookFor = async (selector: TapSelector) => {
    let screen = await readScreen();
    let found = find(selector, screen);
    for (
      const lookedFrom = performance.now();
      !found && performance.now() - lookedFrom < APPEARS_WITHIN_MS;
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      screen = await readScreen();
      found = find(selector, screen);
    }
    return { screen, found };
  };

  try {
    if (step.tap) {
      // A page that began to slide after the last step ended is still moving
      // under the finger; a tap then lands on nothing, or on what was there before.
      await pixels?.pixelsStill();
      let screen = await readScreen();
      let inApp = find(step.tap, screen);
      // A control can be out of the app's tree for a moment while its page
      // draws again. Looking again touches nothing; it is only "not there"
      // once a short while has passed without it.
      for (
        const lookedFrom = performance.now();
        !inApp && !('label' in step.tap) && performance.now() - lookedFrom < APPEARS_WITHIN_MS;
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        screen = await readScreen();
        inApp = find(step.tap, screen);
      }
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
          performance.now() < Math.max(deadline, startedWall + SYSTEM_LOOK_WITHIN_MS)
        );
      }
      if (!inApp && !outside)
        return finish(`Nothing to tap: ${describeSelector(step.tap)} is not on screen`);
      if (inApp?.disabled)
        return finish(`Cannot tap ${describeSelector(step.tap)}: it is disabled`);
      const [across, down] = step.tapAt ?? [0.5, 0.5];
      const at: [number, number] = inApp
        ? [
            (inApp.x + inApp.width * across) / screen.width,
            (inApp.y + inApp.height * down) / screen.height,
          ]
        : outside
          ? [outside.x + outside.width * across, outside.y + outside.height * down]
          : [0, 0];
      for (let tap = 0; tap < (step.taps ?? 1); tap++) await device.tap(...at);
      // Missing feedback cannot establish that an effect did not happen.
      // Observe the expected state below; never repeat the action to obtain it.
    }
    if (step.swipe) {
      const { until } = step.swipe;
      const inTheOpen = (screen: AppScreen) => {
        const sought = until && find(until, screen);
        return (
          !!sought &&
          sought.y >= screen.height * OPEN_BAND[0] &&
          sought.y + sought.height <= screen.height * OPEN_BAND[1]
        );
      };
      for (let swiped = 0; ; swiped++) {
        const { screen, found: target } = await lookFor(step.swipe.on);
        if (until && inTheOpen(screen)) break;
        if (until && swiped === SWIPES_UNTIL_MAX)
          return finish(
            `${describeSelector(until)} did not come into the open after ${SWIPES_UNTIL_MAX} swipes`
          );
        if (!target)
          return finish(`Nothing to swipe: ${describeSelector(step.swipe.on)} is not on screen`);
        // The finger goes down on the part of the element that is on screen: a
        // scrolled page is mostly above or below the glass.
        const left = Math.max(0, target.x);
        const top = Math.max(0, target.y);
        const width = Math.min(screen.width, target.x + target.width) - left;
        const height = Math.min(screen.height, target.y + target.height) - top;
        const [startAcross, startDown] = step.swipe.from ?? [0.5, 0.5];
        const from: [number, number] = [
          (left + width * startAcross) / screen.width,
          (top + height * startDown) / screen.height,
        ];
        const [across, down] = SWIPES[step.swipe.direction];
        const clamp = (fraction: number) => Math.min(0.98, Math.max(0.02, fraction));
        await device.swipe(from, [
          clamp(from[0] + across * step.swipe.distance),
          clamp(from[1] + down * step.swipe.distance),
        ]);
        if (!until) break;
        // The next look is taken once the page has stopped where this swipe left it.
        await pixels?.pixelsStill(STILL_AFTER_SWIPE_MS, SWIPE_SETTLES_WITHIN_MS);
      }
    }
    if (step.handed) {
      if (!hand) return finish('Nothing here can hand the person anything.');
      const lockTo = 'token' in step.handed ? step.handed.token.lockTo : undefined;
      const made = await hand(
        'token' in step.handed && lockTo
          ? { token: { sats: step.handed.token.sats, lockTo: recall(lockTo) } }
          : step.handed
      );
      for (const [name, value] of Object.entries(made)) remembered.set(name, value);
    }
    if (step.open) {
      if (!device.open) return finish('This device cannot open a link.');
      await pixels?.pixelsStill();
      await device.open(recall(step.open));
    }
    if (step.type) {
      if (step.type.into) {
        const { screen, found: target } = await lookFor(step.type.into);
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
      // A focused field can survive a new splash cycle without being targeted
      // again. Check the current map before sending keys to that existing focus.
      await readScreen();
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
        // yet. Sampled pixels can reveal animation off the JavaScript thread.
        motion = step.swipe
          ? await pixels?.pixelsStill(STILL_AFTER_SWIPE_MS, SWIPE_SETTLES_WITHIN_MS)
          : await pixels?.pixelsStill();
        for (const kept of step.remember ?? []) {
          if ('idAfter' in kept) {
            const row = screen.elements.find((element) => element.id?.startsWith(kept.idAfter));
            if (!row?.id)
              return finish(
                `Nothing to remember as ${kept.as}: no id on screen starts with ${kept.idAfter}`
              );
            remembered.set(kept.as, row.id.slice(kept.idAfter.length));
            continue;
          }
          const { as, from: source, after } = kept;
          const seen = find(source, screen);
          const said = seen?.label ?? seen?.text;
          if (said === undefined)
            return finish(
              `Nothing to remember as ${as}: ${describeSelector(source)} is not on screen`
            );
          remembered.set(as, after ? said.slice(said.lastIndexOf(after) + after.length) : said);
        }
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
  afterStep?: (index: number, step: StepResult) => Promise<void>,
  /** Makes what a step says the person is handed, returning it by the name a later step uses. */
  hand?: Hand
): Promise<StoryResult> {
  const steps: StepResult[] = [];
  const remembered = new Map<string, string>();
  for (const [index, step] of story.steps.entries()) {
    const result = await playStep(step, index, link, device, pixels, remembered, hand);
    steps.push(result);
    await afterStep?.(index, result);
    if (!result.ok) break;
  }
  return { id: story.id, ok: steps.every((step) => step.ok), steps };
}
