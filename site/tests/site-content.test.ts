import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { siteCopy } from '../../copy/src/site';

test('release dates and links match the published GitHub entries reviewed on 2026-09-14', () => {
  expect(siteCopy.releases.entries.map(({ version, date, href }) => ({ version, date, href }))).toEqual([
    { version: '0.1.3', date: '2026-09-12', href: 'https://github.com/SovranBitcoin/Sovran/releases/tag/v0.1.3' },
    { version: '0.1.0', date: '2026-06-18', href: 'https://github.com/SovranBitcoin/Sovran/releases/tag/v0.1.0' },
  ]);
  expect(siteCopy.releases.entries[0].items).toEqual([]);
  expect(siteCopy.releases.entries[0].text).toContain('do not include a feature-by-feature changelog');
  expect(siteCopy.releases.entries[1].text).toContain('on iOS');
  expect(siteCopy.releases.note).toContain('Store versions and features may differ');
});

test('roadmap separates ongoing goals from released features and promised dates', () => {
  expect(siteCopy.roadmap.groups.map(group => group.id)).not.toEqual(['now', 'next', 'later']);
  expect(new Set(siteCopy.roadmap.groups.map(group => group.id)).size).toBe(14);
  expect(siteCopy.roadmap.note).toContain('not a list of released features or promised dates');
  expect(siteCopy.roadmap.note).toContain('not confirmed availability in your installed or store version');
  expect(siteCopy.roadmap.statusLabels).toEqual({ complete: 'Complete', 'in-progress': 'In progress', planned: 'Planned' });
  for (const group of siteCopy.roadmap.groups) expect(group.items.length).toBeGreaterThan(0);
});

test('FAQ explains conditional recovery and the specific messaging-key risk', () => {
  const recovery = siteCopy.faq.find(item => item.question === 'How do I back it up?')!.answer;
  expect(recovery).toContain('best-effort search for mints');
  expect(recovery).toContain('available records');
  expect(recovery).toContain('back up its private key separately');
  const identity = siteCopy.faq.find(item => item.question === 'Is my public identity connected to my money?')!.answer;
  expect(identity).toContain('separate Nostr identity keys and Cashu wallet keys');
  expect(identity).toContain('does not recreate your Cashu wallet');
  expect(identity).toContain('retained messages and spend unredeemed ecash tokens inside them');
});

test('mint comparisons retain the reserve and future-reliability limits', () => {
  const custody = siteCopy.faq.find(item => item.question === 'Do I hold my own money?')!.answer;
  expect(custody).toContain('issuing mint holds the backing bitcoin');
  expect(custody).toContain('Community reviews, operator reputations, and payment-test results from auditors');
  expect(custody).toContain('do not prove reserves or guarantee future reliability');
});

test('FAQ source and license links are explicit and availability scrolls to downloads', () => {
  const links = siteCopy.faq.flatMap(item => 'links' in item ? [...item.links] : []);
  expect(links.map(link => link.href)).toEqual([
    'https://github.com/SovranBitcoin/Sovran',
    'https://github.com/SovranBitcoin/Sovran/blob/main/LICENSE',
    '#download',
  ]);
  const home = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  expect(home).toContain('href={link.href}');
  expect(home).toContain('id="download"');
});

test('roadmap and release content stays visible in native Astro without disclosure widgets', () => {
  for (const page of ['roadmap', 'releases']) {
    const source = readFileSync(new URL(`../src/pages/${page}.astro`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/<details\b|<summary\b|<script\b|client:|line-clamp|overflow:\s*hidden/);
  }
  const releases = readFileSync(new URL('../src/pages/releases.astro', import.meta.url), 'utf8');
  expect(releases).not.toContain('<Downloads');
  expect(releases).toContain('href="/download"');
});
