# Semantic checks

Some rules cannot be a lint rule or a test, because deciding them means reading what the code
does: whether a failed read can lead to saved data being replaced, whether a retry can spend
twice. Each of those is a saved question in `.jevlint/checks/<id>/CHECK.md`, run with
[JevLint](https://github.com/Kelbie/hunch). A check does not judge. It returns the source that
bears on its question, and whoever asked reads that source and decides.

To understand code before changing it, ask `jg "<question>"`. The checks come after the change:
run the families it touched and read what comes back to confirm nothing they guard was broken.

## Run

```sh
jevlint check --dry-run           # every question and its scope; free, no model requests
jevlint check 'payments-*'        # one family
jevlint check state-stale-owner   # one check
```

Each check is its own search over the code, a few minutes and around a million input tokens the
first time, far less when repeated on unchanged code. Run the families the change touched, not
all of them. JevLint needs `jg` installed and signed in (`jg auth`, done by the owner); if a
check stops at sign-in, say it was not run rather than asking for a key.

| Family | Asks about | Read with |
| --- | --- | --- |
| `payments-*`, `money-*`, `wallet-*` | Uncertain outcomes, repeated spends, cancellation, request constraints, counters, amounts, units | [contracts](contracts.md) |
| `state-*` | Saved data: failed reads, rehydration, migrations, stale owners, names that locate data | [contracts](contracts.md), [state conventions](conventions-state.md), the `persistence-release-safety` skill |
| `account-*` | The account lock, flows that erase data, memory and mints that belong to one account | [account lifecycle](../architecture/account-lifecycle.md) |
| `secrets-*`, `entropy-*` | Where key material goes and where it comes from | [contracts](contracts.md), [entropy](entropy.md) |
| `nostr-*` | Retrying a signed event, claiming delivery | [contracts](contracts.md) |
| `ui-*`, `perf-*`, `errors-*` | Headers, menus over modals, status notices, list re-renders, raw error text | [building screens](building-screens.md), [header contract](header-contract.md), [modal menus](modal-menu-contract.md) |

## Read the result

Each `# Check:` section repeats the question, then gives ranked files, source blocks and a
`Status:` line. Read the source blocks with the question's allowed cases in mind; most of what
comes back is correct code. A file listed without source is a lead to open. `completed` means
the search finished, not that the code is right, and an empty result does not show a behaviour
is absent. `incomplete` or `failed` means evidence is missing: report what came back and say so.
A check searches the working tree, so an audit of an older commit reads that commit's code
instead. A concern you verify is fixed in a commit or recorded in
[follow-ups](../follow-ups/README.md).

## Add or change a check

Add one when a mistake needed judgement to spot and has happened more than once, or when a
contract in these documents has no question asking about it. A rule with a fixed shape is a lint
rule or a test instead.

1. Create `.jevlint/checks/<family>-<name>/CHECK.md`. Open with one question starting "Where".
2. Below it say what to find (the implementation, its guards, callers and tests), what counts
   as a concern, and what is allowed. Name the owning modules. The text is sent as written and
   links in it are not followed, so the contract goes in the question.
3. To search less than the whole code, add `check.json` beside it: `{ "root": "app" }`.
4. Run `jevlint check <id> --dry-run`, then the check itself, and read whether it returned the
   code you had in mind. Sharpen the wording if it did not.

`jevlint.json` lists what every check skips: documentation, marketing and release folders,
assets, vendored and generated code.

## Beside the checks

[Contributor conventions](contributor-conventions.md) and their per-domain companions
([zod](conventions-zod.md), [React Native and Expo](conventions-react-native.md), [state,
persistence and React](conventions-state.md), [TypeScript](conventions-typescript.md), [async,
errors, network and tests](conventions-async-tests.md)) are the rules people and agents follow
while writing. [contracts.md](contracts.md) defines the domain meanings the checks rely on.

The [sweep protocol](sweep-protocol.md), its [ledger](sweep-ledger.md), the fixtures in
`fixtures/` and the two dated JSON records are the history of the reviewer these checks
replaced. Their verdicts on individual findings still stand.
