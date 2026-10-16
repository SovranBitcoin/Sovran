# An end-to-end test is one user story, run fast, with its evidence

Status: accepted on 2026-10-12. The owned native driver is kept. Worker counts were measured the same day (see
"Measured"). The image capture and pixel-stillness decision is superseded by
[ADR 0034](0034-native-checkpoints-use-fresh-display-captures.md).

Replaces the running model of [the JSON native harness](../testing-json-native-adr.md). Its scenario schema, page
registry, selectors, probes, custody rules and "no second test language" stand.

## What forced the decision

Measured from the 476 runs recorded between 11 and 28 September 2026:

|                                   | iPhone simulator | Android emulator |
| --------------------------------- | ---------------- | ---------------- |
| Median time for one test          | 193 s            | 381 s            |
| Runs with a failure               | 97 of 212        | 69 of 157        |
| Tests that both passed and failed | 21 of 33         | 18 of 34         |

Only about 33 of the 166 scenarios ever ran on a device, none of them one that moves money. The owner walks
releases by hand because the suite cannot be trusted or waited for. The time does not go to the app:

- Returning to the wallet home terminates and relaunches the app, about 20 s each time.
- A tap that expects a result waits a fixed 6 s and is repeated up to four times. Repeating a tap can toggle
  something twice, and "target never appeared" is the commonest failure.
- 164 of 166 scenarios create a simulator, start Metro and install the app; 120 then tap through onboarding.
- Every action stops for a screenshot, two accessibility snapshots and a store dump, 5.8 s at the median, which
  the harness then compensates for by stretching toasts and gestures. That changes what is being tested.
- Nothing runs in parallel, and the app's own log is not collected per test.

## Decision

**What a test is for.** An end-to-end test proves that one thing a person does with the app works through the
real app, wallet and mint: "send 40 sat as ecash and see it leave the balance". It states its purpose in a
sentence and has one outcome. Rules about amounts, parsing, error classes and state machines stay in the unit and
package tests; a story does not re-enumerate them. About 100 stories cover the app.

**A story stands alone.** It names the state it starts from (fresh install, onboarded and empty, funded with
100 sat on one mint, two profiles) and reaches it by having that state copied into place, not by tapping through
earlier flows. A state is where a story in `e2e/stories/states/` ends: it is played once on a simulator and what
it leaves is saved there, the app's files together with the simulator's keychain, which holds the seed. Nothing
in the app is changed or told a seed for this. No story depends on another having run in the same run. Onboarding
is itself a few stories, not the first minute of every one.

**Every action is issued once.** No step repeats a tap, swipe or text entry. A step names what it does and what
must be true afterwards; if that does not come true before its deadline the story fails and says what the app was
still doing.

**The app says when it is settled.** A test build reports, to the runner, when the expected page has committed,
the navigation transition and any scroll or keyboard movement has finished, foreground reads and wallet
operations have ended, and layout has stopped moving. Background relays and endless animations are named and
excluded. The runner waits on that report and on named states (a quote paid, a balance changed), never on a
duration. A wait with no event behind it is a defect in the harness.

**One build, no bundler.** Stories run against a build with its JavaScript inside it. No Metro, no development
overlays, no timing overrides. Structured logging stays on in that build behind its own switch, since it is
otherwise a development-only feature.

**Workers and state.** Each worker builds its own states, so workers hold different wallets and cannot receive
each other's messages. A run prepares one simulator with the build installed and clones it for each worker;
Android boots read-only instances of one warmed emulator image. The prepared simulator has the background
services no story uses switched off, which is what lets several fit in memory. Between stories a worker ends the
app, restores the story's fixture and launches again; it does not reinstall. Each worker has its own wallet seeds, its own
ports, its own output folder named by run, worker and story, and its own mint.

**Two mints.** The everyday run pays through a private mint started on the Mac for each worker, so a payment
confirms at once, nothing depends on the network, and workers cannot disturb each other. A small set of stories
runs against the public test mint to prove the real path, with its 3 to 5 s waits. No story uses real funds; the
funded custody lane stays separate and off by default. The private mint sits behind TLS with a certificate of the run's
own that each simulator is told to trust, since the app accepts a mint only at an `https` address, and its
database is saved and put back with the wallet's state, so a wallet can be returned to any saved moment and spent
from again.

**Evidence is recorded, not staged.** Each story has one continuous video, started before launch and kept as
recorded: full size, a frame for every one the screen drew. Animations stay on, so the video is what a person
would see and the smoothness and shift measurements mean something. The picture for each step is the frame on the
simulator's screen at the moment the step was satisfied, handed over by the simulator as it draws, so capture
never pauses the app. (Cutting pictures from the video by timestamp was tried first and withdrawn: with several
simulators running the recording is written seconds late, and pictures came from the wrong moment.) The same
stream of frames says when the picture has stopped changing, which the app cannot say for an animation that runs
off its JavaScript thread. The app's log is streamed with the run, story and step on every entry.

**The runner judges more than the outcome.** For each step the report carries the page mount and transition
times, layout shifts, dropped frames where measured, and every warning and error, and compares them with budgets.
A story can pass its outcome and still fail a budget. An agent or a person reads the same report: purpose,
steps, pictures, video, log slices and verdicts.

**One story, two platforms.** A story is written once in terms of pages, controls and gestures (tap, type,
scroll to, swipe, go back, dismiss). The platform adapter knows that leaving a flow is a sheet dismissal on
iPhone and a back on Android, and what the keyboard and clipboard prompts look like. A difference a person would
notice is a separate step marked for one platform; a branch on "if visible" is not allowed.

**Budget.** 100 stories in 30 minutes on the owner's MacBook (M4 Pro, 24 GB). With four or five workers that is
80 to 90 s per story; the aim is well under that, so that the tail does not decide the run.

## The driver

The owned native driver is kept, with the app's own report of being settled in place of its guesses from the
accessibility tree. The owner first chose to measure it against Detox on four stories, then decided on the owned
driver the same day. Detox states support up to React Native 0.84 and the app is on 0.85.3, and its Expo support
is community-run; Maestro polls the screen and pauses on every step. Neither removes the need for the app to say
when it is settled, which is where the time is.

## Measured

On the owner's MacBook (M4 Pro, 24 GB) on 2026-10-12, with the first story (first launch, accept Terms and
Privacy; five steps), iPhone 17 Pro simulators on iOS 26.1, video and pictures on:

| Workers | Plays | Passed | Wall time per story |
| ------- | ----- | ------ | ------------------- |
| 1       | 4     | 4      | 15.3 s              |
| 2       | 10    | 10     | 8.5 s               |
| 4       | 16    | 16     | 4.6 s               |
| 6       | 36    | 36     | 2.9 s               |

Those were taken while a first launch still spent nine seconds under the splash. With that fixed the same story
takes 12 s on its own worker, and four workers finish one every 2.8 s. A hundred stories of that length are a few
minutes, well inside the budget; the budget's risk is now the length of the money stories, not the machinery.

- A stock simulator runs about 270 processes and holds 5 GB. With the unused services off it runs about 60, holds
  1 GB and boots in 4 s instead of 20. Six stock simulators exhausted memory and then the disk; six trimmed ones
  fit, though memory is tight beside the owner's other applications. Four is the comfortable default.
- Where a 12 s story's time goes: resetting the app in place 0.6 s (reinstalling took 6.1 s), starting the
  recording 0.3 s, launch to the app answering 1.4 s, the steps, ending the recording 0.4 s, keeping the video
  0.06 s. `simctl` is called directly: through `xcrun` every call costs 0.7 s.
- The local mint starts in 0.15 s and marks an invoice paid in about 20 ms.
- Evidence for one 12 s story is about 7 MB (5.6 MB of video, a 340 KB picture per step).
- Starting from a saved state takes about 1.4 s. A story that opens an already set-up wallet is 3 s of steps and
  7.6 to 9.5 s end to end; the first such story on a worker also builds the state, once, in about 12 s more.

## Open

- Whether simulator frame timing is steady enough to hold a budget, or only to show a regression.
- The screen capture in the simulator's native addon faults about once in fifteen stories. It runs in its own
  process, which is restarted, so a story survives it; a newer release of the addon has not been tried.

## Consequences

The step vocabulary loses `tapUntil`, `delay` and `goHome` as a relaunch. Fixtures that drive the UI to reach a
state are replaced by seeded state. Old scenarios are deleted as the stories that replace them pass, and the
recorded screenshots and store images are regenerated from the new runs. Until a story exists for an area, the
old scenario is what covers it.
