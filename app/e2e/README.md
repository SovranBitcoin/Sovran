# E2E & Visual Parity

Behavior, payment flows, state machines, and persistence upgrades are tested in fast Jest (`app/`) and Vitest (`wallet/`, `nostr/`) suites.

For cheap on-demand iOS & Android visual-parity checks against a booted simulator or emulator:

```bash
cd app
bun run e2e:test                                      # validates smoke screen registry & e2e helpers
bun run e2e:parity -- --plan                          # prints the core wallet screen list
bun run e2e:parity -- --platform ios --mode both      # captures light & dark iOS screenshots
bun run e2e:parity -- --platform android --mode both  # captures light & dark Android screenshots
```

Screenshots and the generated side-by-side comparison sheet are written to `app/e2e/.artifacts/parity.html`.
