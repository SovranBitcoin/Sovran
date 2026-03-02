# Sovran

React Native + Expo Router ecash wallet. Cashu protocol, Nostr identity, NFC payments.

## Before you code

Read `.cursor/rules/` docs before touching their domains. The index is `.cursor/rules/rules-index-authoring-guide.mdc`.

| Domain | Read first |
|---|---|
| Popups, toasts, sheets | `.cursor/rules/popup-toast-sheet-guidelines.mdc` |
| Mnemonic, keys, secure storage | `.cursor/rules/secure-storage-key-derivation.mdc` |
| Text component, fonts, skeletons | `.cursor/rules/text-typography-skeleton-guidelines.mdc` |
| Theme, colors, tokens | `.cursor/rules/theme-system-architecture.mdc` |
| Zustand stores, profile scope | `.cursor/rules/zustand-store-scoping.mdc` |
| Git, commits, PRs, issues | `.cursor/rules/git-github-workflow.mdc` |

If the domain you need isn't documented, check if an existing rule doc covers it partially before creating a new one. See the rule documentation improvement protocol below.

## Commands

```bash
npm run lint          # ESLint
npm run type-check    # tsc --noEmit
npm run pretty:check  # Prettier check
npm run knip          # Dead code
npm test              # Jest
```

All five must pass before any commit.

## Stack

Expo SDK + Expo Router, TypeScript, HeroUI Native, Uniwind (Tailwind v4 for RN), Zustand + AsyncStorage, coco-cashu-core/react/expo-sqlite, nostr-tools, expo-secure-store.

## Architecture (short form)

- `app/` — routes + orchestration (thin screens)
- `components/ui/` — primitives, `components/blocks/` — composed product UI
- `hooks/` — reusable hooks, `hooks/coco/` — cashu hook composition
- `helper/` — stateless utils, `helper/coco/` — cashu integration glue
- `stores/` — Zustand (global, profile-scoped, or runtime-only)
- `.cursor/rules/` — agent-facing rule docs (self-improving, see below)
- `coco-cashu-core` is the source of truth for cashu types and logic. Never redefine coco types. Compose coco hooks, don't reimplement them. Import from coco, not `@cashu/cashu-ts`.

## Rule Documentation Improvement Protocol

When you encounter any of these situations, update `.cursor/rules/` **in the same PR**:

1. **Gap**: You needed info that wasn't documented → add it to the relevant doc, or create a new one following `.cursor/rules/rules-index-authoring-guide.mdc`.
2. **Stale**: A doc contradicts what the code actually does → fix the doc to match reality.
3. **Missing pattern**: You discovered a convention by reading code that future agents would benefit from → append it to the appropriate doc.
4. **Post-mortem**: A bug was caused by violating an undocumented rule → document the rule so it isn't repeated.

Format for new rule docs: see the authoring template in `.cursor/rules/rules-index-authoring-guide.mdc`.

## Security — never commit

Mnemonics, nsec, private keys, API tokens, .env contents. Scan diffs before staging.

## Git

Never commit to `main`. Branch: `type/scope-description`. Conventional commits. Full details in `.cursor/rules/git-github-workflow.mdc`.
