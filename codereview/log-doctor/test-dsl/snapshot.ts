/**
 * @fileoverview Sovran Test DSL — snapshot serialization & structural diff.
 *
 * `snapshot screen as $var` and `assert screen eq $var` are stable
 * regression tools for verifying that a screen looks the same across
 * navigations. The pipeline is:
 *
 *   1. Take a fresh AX tree from WDA (via log-doctor's getCurrentTree).
 *   2. Walk it, dropping any field that would be session-variable
 *      (coordinates, timestamps, fiat amounts, dates, lightning invoices,
 *      etc.) — see SESSION_VARIABLE_PATTERNS below.
 *   3. Keep only the structural identity of each node: type, identifier,
 *      label, name, value, and traits — in that order, sorted, so the
 *      output is deterministic.
 *   4. Serialize to a JSON string for storage in a test variable.
 *
 * Diffing walks both stored snapshots in lockstep, marking added,
 * removed, and changed nodes. The renderer prints the spec-style output:
 *
 *   FAIL: screen differs from $confirmedDetail
 *     #screen-mint-quote
 *       #mint-quote-status
 *   -     label: "Pending"
 *   +     label: "Confirmed"
 *
 * The whole module is pure — no WDA calls. The executor passes in a
 * fetched AX tree and gets back a normalized snapshot. Easy to test.
 */

// ─── Types (mirrors log-doctor.ts AXNode) ──────────────────────────────────

/**
 * Minimal AX tree node shape we accept as input. Mirrors the structure
 * returned by log-doctor's `getCurrentTree()` (which itself is the JSON
 * shape of WDA's `/source` endpoint). Kept here as a duplicate definition
 * so this module is independent of log-doctor.ts.
 */
interface InputAXNode {
  type?: string;
  label?: string | null;
  name?: string | null;
  value?: string | null;
  rawIdentifier?: string | null;
  identifier?: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean | string;
  isEnabled?: boolean | string;
  children?: InputAXNode[];
}

/**
 * The canonical, comparable shape of one node in a snapshot. Sorted keys,
 * no coordinates, no booleans we don't care about. Children recurse.
 */
interface SnapshotNode {
  type: string;
  /** Empty string when absent — keeps JSON output stable. */
  testID: string;
  label: string;
  name: string;
  value: string;
  children: SnapshotNode[];
}

// ─── Session-variable patterns ──────────────────────────────────────────────

/**
 * Patterns whose matches are scrubbed from snapshot strings before
 * comparison. Mirror of TESTS.yml `forbidden_target_patterns`. Anything
 * that legitimately changes between runs (amounts, dates, invoices)
 * gets replaced with a placeholder so two runs of the same screen
 * produce the same snapshot.
 *
 * Test author's mental model: "if I run this screen twice in a row, the
 * thing on screen could legitimately change — so it gets `<…>`'d out."
 *
 * Built-in patterns are seeded here. Test authors can add more by writing
 * regex literals (one per line) to `tests/.snapshot-ignores`; the executor
 * loads that file at startup via `loadSnapshotIgnores()` and merges them
 * into this list. That gives test authors a way to silence trivial diffs
 * (relative-time strings, percentage indicators, etc.) without recompiling.
 */
const SESSION_VARIABLE_PATTERNS: Array<{ re: RegExp; placeholder: string }> = [
  // Fiat amounts: $0.04, $1,234.56
  { re: /\$\d[\d,]*(?:\.\d+)?/g, placeholder: '<fiat>' },
  // Bitcoin amounts: ₿ 464, ₿1,234.567
  { re: /₿\s*\d[\d,]*(?:\.\d+)?/g, placeholder: '<btc>' },
  // sats / btc / bitcoin counts
  { re: /\b\d[\d,]*\s*(?:sats?|btc|bitcoin)\b/gi, placeholder: '<sats>' },
  // ISO-ish dates: 04/10/2026, 04-10-26
  { re: /\b\d{2}[/-]\d{2}[/-]\d{2,4}\b/g, placeholder: '<date>' },
  // Times: 11:38, 18:01:42
  { re: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g, placeholder: '<time>' },
  // Nostr pubkeys: npub1abc...
  { re: /\bnpub1[a-z0-9]+\b/gi, placeholder: '<npub>' },
  // Lightning invoices: lnbc1...
  { re: /\blnbc[a-z0-9]+/gi, placeholder: '<lnbc>' },
  // Cashu tokens (long opaque strings)
  { re: /\bcashu[AB][A-Za-z0-9_-]{20,}/g, placeholder: '<cashu>' },
  // Pending durations: "expires in 59m 56s"
  { re: /\bexpires in\s+\d+\s*[ms]\s*\d*\s*[ms]?/gi, placeholder: '<expires>' },
];

/**
 * Load user-defined ignore patterns from a `.snapshot-ignores` file. Each
 * non-empty, non-comment line is parsed as a regex (with optional flag
 * suffix `/pattern/flags`). Matching text is replaced with `<custom>`
 * during snapshot normalisation.
 *
 * Called once at executor startup. Subsequent calls are no-ops if the
 * file is unchanged.
 */
let loadedIgnoresFrom: string | null = null;
export function loadSnapshotIgnores(filePath: string): void {
  if (loadedIgnoresFrom === filePath) return;
  loadedIgnoresFrom = filePath;
  // Lazy require so this module stays browser-safe-ish (no eager fs).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    try {
      // Accept either `pattern` or `/pattern/flags` form.
      let re: RegExp;
      const slashMatch = /^\/(.*)\/([gimsuy]*)$/.exec(line);
      if (slashMatch) {
        re = new RegExp(
          slashMatch[1],
          slashMatch[2].includes('g') ? slashMatch[2] : slashMatch[2] + 'g'
        );
      } else {
        re = new RegExp(line, 'g');
      }
      SESSION_VARIABLE_PATTERNS.push({ re, placeholder: '<custom>' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[snapshot-ignores] skipping invalid pattern "${line}": ${(err as Error).message}`
      );
    }
  }
}

/**
 * Strip session-variable text from a string. Returns the original if no
 * pattern matched.
 */
function scrubSessionVariableText(s: string): string {
  let out = s;
  for (const { re, placeholder } of SESSION_VARIABLE_PATTERNS) {
    out = out.replace(re, placeholder);
  }
  return out;
}

// ─── Build a snapshot from an AX tree ──────────────────────────────────────

/**
 * Normalise an AX tree into the canonical SnapshotNode shape. Pass a
 * filter to limit the snapshot to a subtree (used for the
 * `snapshot <#id> as $var` form).
 *
 * The filter is invoked top-down. The first node where it returns true
 * becomes the root of the snapshot; everything else is dropped. This
 * matches the user expectation: "snapshot the receive screen container"
 * grabs that container plus all of its descendants.
 */
export function buildSnapshot(
  root: InputAXNode,
  rootSelector?: { kind: 'id'; id: string }
): SnapshotNode | null {
  if (!rootSelector) {
    return normaliseNode(root);
  }
  // Find the first descendant matching the testID, then snapshot from there.
  const found = findFirstByID(root, rootSelector.id);
  return found ? normaliseNode(found) : null;
}

function normaliseNode(node: InputAXNode): SnapshotNode {
  const type = (node.type || '').replace('XCUIElementType', '');
  const testID = node.rawIdentifier || node.identifier || '';
  const label = scrubSessionVariableText(node.label || '');
  const name = scrubSessionVariableText(node.name || '');
  const value = scrubSessionVariableText(node.value || '');
  const children = (node.children || []).map(normaliseNode);
  return { type, testID, label, name, value, children };
}

// ─── Tree pruning (semantic skeleton) ──────────────────────────────────────

/**
 * Interactive / semantically-meaningful XCUIElementTypes. Nodes of these
 * types are always kept during pruning even if they carry no testID,
 * label, or value — they shape the user-visible structure of the screen
 * regardless of whether the test author has annotated them.
 *
 * The list mirrors the types that XCUITest classifies via
 * UIAccessibilityTraits: buttons, text inputs, selection controls, etc.
 * Plain containers (`Other`, `Window`, `Group`) are excluded — those are
 * the wrappers we want to collapse.
 */
const SEMANTIC_TYPES = new Set<string>([
  'Button',
  'Link',
  'Image',
  'StaticText',
  'TextField',
  'SecureTextField',
  'SearchField',
  'Switch',
  'Slider',
  'Toggle',
  'Picker',
  'PickerWheel',
  'Cell',
  'NavigationBar',
  'TabBar',
  'Alert',
  'Sheet',
  'CheckBox',
  'RadioButton',
]);

/**
 * A node is "meaningful" if it carries a developer annotation (`testID`),
 * user-facing text (`label`/`name`/`value`), or is a native interactive
 * type. Everything else is scaffolding — a layout wrapper, a flex
 * container, an `RCTView` that exists only to host children.
 *
 * Pruning keeps meaningful nodes and collapses the rest. See the
 * research notes in the user brief: React Native apps generate 30–60+
 * levels of anonymous `Other` nodes because every `<View>` becomes an
 * `RCTView`, which XCUITest classifies as `XCUIElementTypeOther`. The
 * raw tree is unreadable; the pruned tree is the semantic skeleton of
 * what the user actually sees.
 */
function isMeaningful(node: SnapshotNode): boolean {
  if (node.testID) return true;
  if (node.label || node.name || node.value) return true;
  if (SEMANTIC_TYPES.has(node.type)) return true;
  return false;
}

/**
 * Recursively prune a SnapshotNode tree into its semantic skeleton.
 * Rules applied bottom-up:
 *
 *   1. Prune children first so a wrapper full of empty `Other` nodes
 *      becomes a wrapper with zero children, which then triggers the
 *      wrapper's own removal.
 *   2. Collapse StaticText-wrapping-StaticText duplicates — iOS
 *      frequently reports the same string as both the outer
 *      `accessibilityLabel` AND an inner `StaticText` child, so the
 *      raw tree is full of lines like
 *          StaticText "Pending"
 *            StaticText "Pending"
 *      which are pure noise. If a node's type/label matches its only
 *      child's type/label, drop the child.
 *   3. If the node is meaningful, keep it with its pruned children.
 *   4. If the node is NOT meaningful, hoist its pruned children into
 *      the parent — the node itself disappears.
 *
 * Because hoisting can produce multiple children where there was one,
 * this returns an array rather than a single node. Callers flatten
 * the top-level result (there must always be a single root for the
 * serialization format to make sense).
 */
function pruneNode(node: SnapshotNode): SnapshotNode[] {
  let prunedChildren = node.children.flatMap(pruneNode);

  // StaticText-in-StaticText de-dup. A one-child wrapper whose child
  // has the same type + label + name + value is redundant — typical
  // iOS behavior on RN `<Text>` elements. Empty the children so the
  // line renders once, not twice.
  if (
    prunedChildren.length === 1 &&
    prunedChildren[0].type === node.type &&
    prunedChildren[0].label === node.label &&
    prunedChildren[0].name === node.name &&
    prunedChildren[0].value === node.value &&
    prunedChildren[0].children.length === 0
  ) {
    prunedChildren = [];
  }

  if (isMeaningful(node)) {
    return [{ ...node, children: prunedChildren }];
  }
  // Hoist children into parent.
  return prunedChildren;
}

/**
 * Public entry point — prune from a root and guarantee a single root
 * survives. If pruning the root itself produces zero nodes (because it
 * wasn't meaningful and had no meaningful descendants) we fall back to
 * the unpruned root so the caller never gets nothing back.
 *
 * If pruning produces more than one top-level node (because the root
 * was a scaffolding wrapper around several meaningful children), we
 * wrap them in a synthetic `Root` node so the output is still a tree.
 */
export function pruneSnapshot(root: SnapshotNode): SnapshotNode {
  const pruned = pruneNode(root);
  if (pruned.length === 0) return root;
  if (pruned.length === 1) return pruned[0];
  return { type: 'Root', testID: '', label: '', name: '', value: '', children: pruned };
}

// ─── Text format (git-diff friendly) ───────────────────────────────────────

/**
 * Render a SnapshotNode tree as an indented line-based text format,
 * one node per line. Designed for git diffs: adding or removing a row
 * shows up as a single `+`/`-` line, moving a row shows as a pair.
 *
 * Line shape:
 *   `<indent><Type>[ #<testID>][ "<label or name>"][ = "<value>"]`
 *
 * Indent is two spaces per level. Text fields are scrubbed of
 * session-variable content upstream (`scrubSessionVariableText`) so
 * timestamps / amounts don't produce diff noise between runs.
 *
 * Inspired by Playwright's ARIA snapshot format but adapted for
 * XCUITest types and testIDs — Playwright uses ARIA roles, we use
 * stripped iOS element types since React Native doesn't reliably map
 * to ARIA.
 */
export function formatSnapshotText(root: SnapshotNode): string {
  const lines: string[] = [];
  const walk = (node: SnapshotNode, depth: number): void => {
    const parts: string[] = [];
    const indent = '  '.repeat(depth);
    parts.push(node.type || '(unknown)');
    if (node.testID) parts.push(`#${node.testID}`);
    // Prefer label over name — both are often identical on iOS, and
    // label is the more semantically "what the user sees" field.
    // Skip the text field entirely when it's just the testID repeated
    // (iOS sometimes sets accessibilityLabel to accessibilityIdentifier
    // if the caller didn't provide one explicitly), since that's pure
    // noise after we've already shown `#<testID>`.
    const text = node.label || node.name;
    if (text && text !== node.testID) parts.push(JSON.stringify(text));
    if (node.value && node.value !== text && node.value !== node.testID) {
      parts.push(`= ${JSON.stringify(node.value)}`);
    }
    lines.push(`${indent}${parts.join(' ')}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n') + '\n';
}

function findFirstByID(node: InputAXNode, id: string): InputAXNode | null {
  const ident = node.rawIdentifier || node.identifier;
  if (ident === id) return node;
  if (node.children) {
    for (const c of node.children) {
      const hit = findFirstByID(c, id);
      if (hit) return hit;
    }
  }
  return null;
}

// ─── Serialization (stable JSON) ───────────────────────────────────────────

/**
 * Stable JSON serialization of a SnapshotNode for storage in a test
 * variable. Uses sorted keys (the SnapshotNode shape is already a fixed
 * key order) so byte-equality is meaningful.
 */
export function serializeSnapshot(snap: SnapshotNode): string {
  return JSON.stringify(snap);
}

export function deserializeSnapshot(s: string): SnapshotNode {
  return JSON.parse(s) as SnapshotNode;
}

// ─── Structural diff ───────────────────────────────────────────────────────

/**
 * One change in the structural diff. The renderer indents these by
 * `depth` to mirror the spec-style output:
 *
 *   #screen-mint-quote
 *     #mint-quote-status
 *   -     label: "Pending"
 *   +     label: "Confirmed"
 */
type DiffEntry =
  | { kind: 'context'; depth: number; line: string }
  | { kind: 'remove'; depth: number; line: string }
  | { kind: 'add'; depth: number; line: string };

/**
 * Diff two snapshots structurally. Returns an empty array when they're
 * equal. The diff walks both trees in lockstep, comparing children by
 * position. Insertion/deletion is detected via length mismatch — there's
 * no longest-common-subsequence here because UI snapshots are mostly
 * structural and a positional walk gives clearer diagnostics than
 * minimum-edit-distance fuzziness.
 */
export function diffSnapshots(a: SnapshotNode, b: SnapshotNode): DiffEntry[] {
  const out: DiffEntry[] = [];
  diffNode(a, b, 0, out);
  return out;
}

function diffNode(a: SnapshotNode, b: SnapshotNode, depth: number, out: DiffEntry[]): void {
  const header = nodeHeader(a, b);
  const childOut: DiffEntry[] = [];

  // Compare scalar fields.
  const scalarDiffs: DiffEntry[] = [];
  pushFieldDiff(scalarDiffs, depth + 1, 'type', a.type, b.type);
  pushFieldDiff(scalarDiffs, depth + 1, 'label', a.label, b.label);
  pushFieldDiff(scalarDiffs, depth + 1, 'name', a.name, b.name);
  pushFieldDiff(scalarDiffs, depth + 1, 'value', a.value, b.value);

  // Compare children.
  const aLen = a.children.length;
  const bLen = b.children.length;
  const common = Math.min(aLen, bLen);
  for (let i = 0; i < common; i++) {
    diffNode(a.children[i], b.children[i], depth + 1, childOut);
  }
  for (let i = common; i < aLen; i++) {
    childOut.push({ kind: 'remove', depth: depth + 1, line: nodeOneLine(a.children[i]) });
  }
  for (let i = common; i < bLen; i++) {
    childOut.push({ kind: 'add', depth: depth + 1, line: nodeOneLine(b.children[i]) });
  }

  // Only emit a header (and the children block) if anything inside differs.
  if (scalarDiffs.length > 0 || childOut.length > 0) {
    out.push({ kind: 'context', depth, line: header });
    for (const e of scalarDiffs) out.push(e);
    for (const e of childOut) out.push(e);
  }
}

function pushFieldDiff(out: DiffEntry[], depth: number, field: string, a: string, b: string): void {
  if (a === b) return;
  out.push({ kind: 'remove', depth, line: `${field}: ${JSON.stringify(a)}` });
  out.push({ kind: 'add', depth, line: `${field}: ${JSON.stringify(b)}` });
}

function nodeHeader(a: SnapshotNode, _b: SnapshotNode): string {
  if (a.testID) return `#${a.testID}`;
  if (a.name) return `${a.type} "${a.name}"`;
  if (a.label) return `${a.type} "${a.label}"`;
  return a.type || '(unknown)';
}

function nodeOneLine(n: SnapshotNode): string {
  const id = n.testID ? `#${n.testID} ` : '';
  const text = n.name || n.label || '';
  return `${id}${n.type}${text ? ` "${text}"` : ''}`;
}

// ─── Diff renderer ─────────────────────────────────────────────────────────

/**
 * Render a diff to the spec-style multi-line string. The first line is
 * `FAIL: <reason>`, then each entry is indented by 2 spaces per depth,
 * with `-`/`+` prefixes for changes.
 */
export function renderDiff(diff: DiffEntry[], reason: string): string {
  const lines: string[] = [`FAIL: ${reason}`];
  for (const e of diff) {
    const indent = '  '.repeat(e.depth + 1);
    const prefix = e.kind === 'remove' ? '-' : e.kind === 'add' ? '+' : ' ';
    // For remove/add, drop one space of indent so the marker aligns at the
    // start of the line (matching the spec example).
    if (e.kind === 'context') {
      lines.push(`${indent}${e.line}`);
    } else {
      lines.push(`${prefix}${indent.slice(1)}${e.line}`);
    }
  }
  return lines.join('\n');
}
