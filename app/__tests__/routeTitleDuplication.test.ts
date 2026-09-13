import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The navigation header owns a page's title. A screen body that repeats the
 * same words as a heading shows the title twice ("Quick check" / "Quick
 * check"). This scans route titles under app/app and fails when a feature
 * screen renders that exact text as a bold heading-sized Text.
 */
const ROOT = join(__dirname, '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}
it('no screen repeats its navigation title as a bold heading', () => {
  const titles = new Set<string>();
  for (const file of walk(join(ROOT, 'app'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/title: '([^']+)'/g))
      titles.add(match[1]);
  }
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'features'))) {
    const source = readFileSync(file, 'utf8');
    for (const title of titles) {
      const heading = new RegExp(
        `<Text[^>]*size=\\{2\\d\\}[^>]*bold[^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`
      );
      if (heading.test(source)) offenders.push(`${relative(ROOT, file)} repeats "${title}"`);
    }
  }
  expect(offenders).toEqual([]);
});
