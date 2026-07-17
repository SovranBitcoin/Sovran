/**
 * Pure per-line renderer for the job console. CLI job output is not arbitrary
 * text: the child runs non-TTY with FORCE_COLOR=0, so every runner line comes
 * from reporting/format.ts `lineFor()` — a fixed grammar of glyph-prefixed
 * lines — plus a few `[e2e] …` meta lines from cli.ts. Each line maps to one
 * `.console-line` row with the same token vocabulary as the steps pane
 * (tok-id / tok-kind / tok-dur); anything unrecognised falls through as a
 * plain muted row, never mangled.
 */

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Leading status glyph → glyph span class + optional row-level class. */
const GLYPHS: Record<string, { cls: string; row?: string }> = {
  '✓': { cls: 'ok' },
  '✗': { cls: 'fail', row: 'fail' },
  '╰': { cls: 'fail', row: 'fail' }, // error continuation under a failed step
  '⚠': { cls: 'warn', row: 'warn' },
  '↺': { cls: 'warn', row: 'warn' },
  '▶': { cls: 'run', row: 'section' },
  '▸': { cls: 'dim' },
  '▣': { cls: 'dim' },
  '♻': { cls: 'dim' },
  '◌': { cls: 'dim' },
  '⏭': { cls: 'dim' },
  '→': { cls: 'dim' },
  '·': { cls: 'dim' },
};

/** One pass over the (already escaped) text after the glyph: bracket ids
 * (`[step-3]`, `[#01]`), phase labels, and a trailing duration. A single
 * alternation keeps matches from nesting. */
const TOKENS =
  /(\[[^\]]+\])|(\b(?:TEST START|TEST|VERIFY|PRECONDITION|CLEANUP)\b)|((?:\d+ms|\d+(?:\.\d+)?s)\s*$)/g;

function tokenize(escaped: string): string {
  return escaped.replace(TOKENS, (match, bracket, phase, duration) => {
    if (bracket) return `<span class="tok-id">${bracket}</span>`;
    if (phase) return `<span class="tok-kind">${phase}</span>`;
    return `<span class="tok-dur">${duration}</span>`;
  });
}

/** `scenario <id>` / `fixture <id>` highlight only when the subject opens the
 * text after the glyph (`▶ scenario x`, `✓ fixture y #1`) — never when the
 * words appear mid-sentence in a label or quarantine reason. */
function tokenizeRest(escaped: string): string {
  const subject = /^(\s*)(scenario|fixture)(\s+)(\S+)/.exec(escaped);
  if (!subject) return tokenize(escaped);
  const [whole, indent, keyword, gap, id] = subject;
  return `${indent}${keyword}${gap}<span class="tok-id">${id}</span>${tokenize(escaped.slice(whole.length))}`;
}

/** Renders one console line as a `.console-line` row (HTML string). */
export function renderConsoleLine(line: string): string {
  const escaped = escapeHtml(line);

  if (/^\s*─{3,}\s*$/.test(line)) return `<div class="console-line sep">${escaped}</div>`;
  if (line.startsWith('[e2e]')) {
    return `<div class="console-line meta"><span class="tok-id">[e2e]</span>${tokenize(escaped.slice('[e2e]'.length))}</div>`;
  }

  const match = /^(\s*)(\S)/.exec(line);
  const glyph = match ? GLYPHS[match[2]] : undefined;
  if (!glyph) {
    // run summary tallies, blank lines, and any foreign output
    const section = line.includes('scenario(s) ·') ? ' section' : '';
    return `<div class="console-line${section}">${tokenize(escaped) || ' '}</div>`;
  }

  const [, indent, head] = match!;
  const rest = tokenizeRest(escapeHtml(line.slice(indent.length + head.length)));
  const row = glyph.row ? ` ${glyph.row}` : '';
  return `<div class="console-line${row}">${indent}<span class="glyph ${glyph.cls}">${escapeHtml(head)}</span>${rest}</div>`;
}
