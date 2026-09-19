/**
 * How a copyable payment value is shown so the user can check it against what
 * lands on their clipboard: one line, `head ···· tail`, two four-character
 * blocks each side (`bc1q w508 ···· ygt0 8025`). Every block — the gap marker
 * included — is four characters wide, so rows line up in the monospace face.
 *
 * Eight characters each end is a deliberate trade for a single compact line.
 * An address carries a fixed prefix (`bc1q`), so the check covers twelve
 * random characters: far beyond the four-to-six a clipboard hijacker or an
 * address-poisoning look-alike can cheaply match, though not the whole value.
 *
 * A `lightningAddress` (`npub1…@npub.cash`) reads as one address, not blocks:
 * only a long name before the `@` is shortened, keeping any bech32 prefix plus
 * four characters and the last four (`npub1qqqs…0x6w@npub.cash`), so the
 * domain — which decides who is paid — stays visible and the line stays short.
 * Grouping and shortening are display only; the caller copies the raw value.
 */

export type VerifiableKind = 'code' | 'lightningAddress';

const GROUP = 4;
const EDGE = 2 * GROUP;
const GAP = '····';

function group(value: string): string {
  const blocks: string[] = [];
  for (let i = 0; i < value.length; i += GROUP) blocks.push(value.slice(i, i + GROUP));
  return blocks.join(' ');
}

function formatCode(value: string): string {
  if (value.length <= 2 * EDGE + GROUP) return group(value);
  return `${group(value.slice(0, EDGE))} ${GAP} ${group(value.slice(-EDGE))}`;
}

export function formatVerifiableValue(value: string, kind: VerifiableKind = 'code'): string {
  if (kind === 'lightningAddress') {
    const at = value.lastIndexOf('@');
    if (at <= 0) return value;
    const name = value.slice(0, at);
    // A short, human name ("satoshi@…") reads better unbroken.
    if (name.length <= 2 * EDGE + GROUP) return value;
    // Keep an `npub1`-style prefix whole so the four checked characters after
    // it carry information.
    const prefix = /^[a-z]+1/.exec(name)?.[0] ?? '';
    const head = name.slice(0, prefix.length + GROUP);
    return `${head}…${name.slice(-GROUP)}${value.slice(at)}`;
  }
  return formatCode(value);
}
