---
name: sovran-native-ui-review
description: Review or refine Sovran Expo/React Native screens for UI inconsistency, unnecessary decoration, task clarity, insets, truncation, accessibility, loading states, and iOS/Android behavior. Use for native UI quality work, not website styling.
license: Apache-2.0
---

Read the relevant [SYSTEM.md UI decisions](../../SYSTEM.md#3-page-containers-insets-and-keyboards)
and [skill restrictions](../../SYSTEM.md#29-project-skills-and-review-policy).
Start from the existing screen, components, tokens, and intended task. Refinement
preserves the product's visual identity and behavior unless redesign is requested.

Inspect the flow, not just a screenshot:

1. Can users identify the main action and current state without reading repeated
   headings? Remove gratuitous card nesting, competing accents, ornamental badges,
   oversized dashboard-style heroes, and decorative motion only where they impede
   this task. Familiar native controls and restrained layout are useful defaults.
2. Does the screen reuse `Screen`, `List`, typography, icon registry, Uniwind
   tokens, and established platform variants? Do not replace them with generic
   SwiftUI/Material recipes, new CSS frameworks, or a new font/icon package.
3. Check safe-area/footer/keyboard ownership, back and dismissal behavior, touch
   target spacing, focus order, VoiceOver/TalkBack, text scaling, reduced motion,
   and supported older-iOS fallbacks. A browser preview cannot prove native layout.
4. Exercise initial loading, stale content, empty results, failure, pending save,
   and recovery as applicable. Avoid invented progress and decorative skeletons
   that do not match content. Preserve drafts and usable content on failure.
5. Challenge text with long names, localized short/full labels, RTL, missing media,
   small windows, and accessibility sizes. Apply SYSTEM.md's content-specific
   truncation policy rather than a universal one-line limit.

For an audit, report concrete location, user impact, evidence, and proposed owner;
keep source candidates separate from reproduced native failures. For a requested
fix, implement and verify the scoped change. Do not generate a numerical design
score as a substitute for evidence or change every screen during one-screen work.

For performance claims use [Callstack's skill](../react-native-best-practices/SKILL.md)
with SYSTEM.md's measurement/memoization limits. Missing memoization is not itself
a performance defect. Report device/build/scenario and any verification gap.

Adapted from Impeccable's `operate`, `audit.native`, `harden`, `ios`, and `android`
references; provenance is in [sources.json](../sources.json). Adaptation removes
web CSS, compulsory system fonts/icons, launcher downloads, hooks, automatic
document creation, and workflow handoffs. Native concepts are applied through
Sovran's existing components and supported OS contracts.
