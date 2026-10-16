# Native checkpoints use fresh display captures

Accepted on 2026-10-16. This supersedes the cached frame and continuous pixel-stillness
claims in ADR 0033; its action-once rule and continuous-video requirement remain.

A live iOS story produced five identical home-screen screenshots while its independent
video showed Terms, Privacy and onboarding. A responsive capture process, even one receiving
callbacks, can keep reading an obsolete simulator display surface. Neither process liveness
nor a recent callback proves that an image represents the current display.

Each iOS checkpoint therefore asks `simctl` for a fresh internal-display image and decodes
it before accepting it. Settling compares fresh decoded samples separated by an observation
interval; it can miss movement between samples and is labelled accordingly. Slow, failed
or invalid captures cannot stand in for a quiet screen. Capture latency is part of the test,
not application performance, and each checkpoint retains its acquisition interval.

This costs more than reading a cached frame but removes the separate native capture watcher
and its recovery protocol. The video, screenshots, control maps and logs remain independent
observations that reviewers must reconcile. The performance gate stays closed until measured
on the required device and build; sampled equality cannot satisfy it.
