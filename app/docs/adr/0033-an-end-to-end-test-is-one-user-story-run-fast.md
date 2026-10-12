# An end-to-end test is one user story, run fast, with its evidence

Status: accepted on 2026-10-12. The owned native driver is kept; how many workers the Mac carries is still to be
measured (see "Open").

Replaces the running model of [the JSON native harness](../testing-json-native-adr.md). Its scenario schema, page
registry, selectors, probes, custody rules and "no second test language" stand.

## What forced the decision

Measured from the 476 runs recorded between 11 and 28 September 2026:

| | iPhone simulator | Android emulator |
| --- | --- | --- |
| Median time for one test | 193 s | 381 s |
| Runs with a failure | 97 of 212 | 69 of 157 |
| Tests that both passed and failed | 21 of 33 | 18 of 34 |

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

**A story stands alone.** It names the state it starts from (a fixture: fresh install, onboarded and empty,
funded with 100 sat on one mint, two profiles) and reaches it by seeding, not by tapping through earlier flows.
No story depends on another having run. Onboarding is itself a few stories, not the first minute of every one.

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

**Workers and state.** A run prepares one simulator with the build installed and clones it for each worker;
Android boots read-only instances of one warmed emulator image. Between stories a worker ends the app, restores
the story's fixture and launches again; it does not reinstall. Each worker has its own wallet seeds, its own
ports, its own output folder named by run, worker and story, and its own mint.

**Two mints.** The everyday run pays through a private mint started on the Mac for each worker, so a payment
confirms at once, nothing depends on the network, and workers cannot disturb each other. A small set of stories
runs against the public test mint to prove the real path, with its 3 to 5 s waits. No story uses real funds; the
funded custody lane stays separate and off by default.

**Evidence is recorded, not staged.** Each story has one continuous video, started before launch. Animations
stay on, so the video is what a person would see and the smoothness and shift measurements mean something. The
picture for each step is cut from the video at the step's timestamp after the story ends, so capture never pauses
the app. The app's log is streamed with the run, story and step on every entry.

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

## Open

- **How many workers** this Mac carries with recording on, and how much disk a run needs. 17 GB was free when
  this was written, so cleaning up clones and bounding evidence are part of done.
- Whether simulator frame timing is steady enough to hold a budget, or only to show a regression.

## Consequences

The step vocabulary loses `tapUntil`, `delay` and `goHome` as a relaunch. Fixtures that drive the UI to reach a
state are replaced by seeded state. Old scenarios are deleted as the stories that replace them pass, and the
recorded screenshots and store images are regenerated from the new runs. Until a story exists for an area, the
old scenario is what covers it.
