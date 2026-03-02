# Knowledge Index and Authoring Guidelines

This is the entry point for Sovran knowledge docs.

Use it to:
- quickly find the right doc for a task
- understand scope boundaries before changing architecture
- follow a consistent format when adding new knowledge

---

## Knowledge Index

### `knowledge/secure-storage-key-derivation.md`

Security-critical source of truth for mnemonic storage, key derivation paths, per-account isolation, and secure storage key schemas. Read this before touching mnemonic, seed, account derivation, or secure-storage behavior.

### `knowledge/theme-system-architecture.md`

Theme architecture for HeroUI + Uniwind, semantic token mapping, provider responsibilities, and runtime color usage patterns. Read this before changing theme variables, color tokens, or theme switching behavior.

### `knowledge/popup-system-guidelines.md`

Centralized popup/toast/sheet system conventions, file ownership, and copy patterns. Read this before adding or changing user-facing popup flows.

### `knowledge/text-system-guidelines.md`

Canonical text component rules, font/weight usage, and built-in skeleton/loading behavior. Read this before updating typography or text loading patterns.

### `knowledge/zustand-store-scoping.md`

Zustand state scoping policy (global vs profile vs runtime), persistence boundaries, and profile switch/reset contracts. Read this before adding or modifying stores.

---

## How to Write a Knowledge File

### 1) Start with purpose and scope

Open with 2-4 lines that clearly state:
- what the doc governs
- what is explicitly in scope
- which changes require reading it first

### 2) Define architecture ownership

List key files and responsibilities so ownership is unambiguous. Prefer a short table:
- file path
- role
- main consumers

### 3) Document non-negotiable rules

Include explicit “must/must not” rules for high-risk areas:
- security boundaries
- persistence boundaries
- source-of-truth boundaries
- migration/backward compatibility constraints

### 4) Include lifecycle behavior

Document behavior at lifecycle boundaries when relevant:
- startup/init
- profile switch
- reset/delete flows
- cache invalidation/re-derive triggers

### 5) Keep examples concrete

Use concise snippets and concrete keys/paths/API names. Avoid vague wording when exact behavior matters.

### 6) Capture verification steps

Add a small “how to verify” section for risky systems (e.g., tests, runtime checks, expected outcomes).

### 7) Prefer updates over duplicates

Before creating a new knowledge file:
- check whether an existing file already owns the topic
- extend the existing file if ownership already exists
- only add a new file when the topic is truly distinct

### 8) Name files for discoverability

Use readable, keyword-rich kebab-case names:
- clear domain first (`theme`, `popup`, `secure-storage`, `zustand`)
- short qualifier second (`architecture`, `guidelines`, `scoping`)
- avoid overly long names when shorter is still searchable

---

## Suggested Template

```md
# <Title>

<2-4 line purpose/scope statement>

## Architecture Overview
<high-level flow>

## Key Files and Ownership
<table>

## Rules
<must/must-not bullets>

## Lifecycle Behavior
<init/switch/reset/invalidation behavior>

## Verification
<tests/checklist>
```

