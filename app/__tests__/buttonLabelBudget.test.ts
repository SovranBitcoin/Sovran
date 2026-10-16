/**
 * Button labels have to fit the narrowest phone the app supports, at the
 * geometry the footer and `Button` actually use. This is arithmetic, not
 * taste, so it is a test:
 *
 *   window 360dp
 *   − 2 × 16 gutter (footer inset 12 + Button margin 4)   → 328dp button
 *   − 2 × 16 Button horizontal padding                         → 296dp label
 *
 * A semibold 16px label averages about 9dp a character, and the system font
 * scale people commonly set is 1.15×, so one full-width button holds
 * 296 / (9 × 1.15) ≈ 28 characters. Two buttons share the row EQUALLY (the
 * footer gives each a basis of zero, so a long label cannot borrow room from
 * a short one): each label gets (328 − 8 gap) / 2 − 32 = 128dp, which is 12
 * characters at that scale. A third button is the 52dp dots button, which
 * leaves each label (328 − 52 − 16) / 2 − 32 = 98dp, about 9 characters —
 * the footer's first two labels have to fit that too when a third can show.
 *
 * A label built from a count or an amount has no longest value, so it cannot
 * be budgeted at all: it is not allowed in a shared row, and a solo one is
 * listed by name below with the reason it is bounded.
 *
 * A label that does not fit is a copy problem. Shorten it; do not shrink the
 * type or let it wrap, and do not raise these numbers without re-doing the
 * sum against a real 360dp device.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SOLO_MAX = 28;
const PAIRED_MAX = 12;
const WITH_DOTS_MAX = 9;
/** Interpolated footer labels that are allowed, and why each stays short. */
const BOUNDED_TEMPLATES: Record<string, string> = {
  // Solo button; the count is the number of pending rows on screen.
  'Cancel ${visiblePendingEcash.length} pending':
    'features/transactions/screens/TransactionsScreen.tsx',
  // Paired with Cancel; "Add (" + at most three digits + ")" is nine characters.
  'Add (${selectedMints.size})': 'features/mint/screens/MintAddScreen.tsx',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FILES = ['app', 'features', 'shared'].flatMap((dir) => sourceFiles(join(ROOT, dir)));

interface Label {
  text: string;
  where: string;
}

/** `text="…"` / `text={'…'}` on a `<Button>`. */
function soloLabels(): Label[] {
  const labels: Label[] = [];
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /<Button\b[^>]*?\btext=(?:"([^"]+)"|\{'([^']+)'\}|\{"([^"]+)"\})/gs
    )) {
      labels.push({
        text: (match[1] ?? match[2] ?? match[3])!,
        where: relative(ROOT, file),
      });
    }
  }
  return labels;
}

/** Literal `text:` entries of a `buttons={[ … ]}` array, grouped per array. */
function footerGroups(): Label[][] {
  const groups: Label[][] = [];
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    for (const block of source.matchAll(/\bbuttons=\{\[(.*?)\]\}/gs)) {
      const labels = [...block[1]!.matchAll(/\btext:\s*(['"])([^'"]+)\1/g)].map((match) => ({
        text: match[2]!,
        where: relative(ROOT, file),
      }));
      if (labels.length > 0) groups.push(labels);
    }
  }
  return groups;
}

const describeLabel = ({ text, where }: Label) => `"${text}" (${text.length}) in ${where}`;

describe('button label budget', () => {
  it('finds the labels it is meant to guard', () => {
    // A refactor that renames `Button` or `buttons` must not turn this suite
    // into one that passes by matching nothing.
    expect(soloLabels().length).toBeGreaterThan(20);
    expect(footerGroups().length).toBeGreaterThan(5);
  });

  it(`keeps a full-width button label within ${SOLO_MAX} characters`, () => {
    const tooLong = [...soloLabels(), ...footerGroups().flat()].filter(
      (label) => label.text.length > SOLO_MAX
    );
    expect(tooLong.map(describeLabel)).toEqual([]);
  });

  it(`keeps the first two labels of a three-button footer within ${WITH_DOTS_MAX} characters`, () => {
    // The first two keep their labels; the third becomes the dots button.
    // Progress wording ("Cancelling...") is exempt: it replaces a label that
    // fits, and the Button shrinks it rather than wrapping.
    const tooLong = footerGroups()
      .filter((group) => group.length >= 3)
      .flatMap((group) => group.slice(0, 2))
      .filter((label) => label.text.length > WITH_DOTS_MAX && !/(\.\.\.|…)$/.test(label.text));
    expect(tooLong.map(describeLabel)).toEqual([]);
  });

  it('allows a count or an amount in a footer label only where it is known to stay short', () => {
    const found: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const block of source.matchAll(/\bbuttons=\{\[(.*?)\]\}/gs)) {
        for (const match of block[1]!.matchAll(/\btext:[^,]*?`([^`]*\$\{[^`]*)`/g)) {
          const where = relative(ROOT, file);
          if (BOUNDED_TEMPLATES[match[1]!] !== where) found.push(`\`${match[1]}\` in ${where}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it(`keeps each label of a two-button footer within ${PAIRED_MAX} characters`, () => {
    const tooLong = footerGroups()
      .filter((group) => group.length >= 2)
      .flat()
      .filter((label) => label.text.length > PAIRED_MAX);
    expect(tooLong.map(describeLabel)).toEqual([]);
  });
});
