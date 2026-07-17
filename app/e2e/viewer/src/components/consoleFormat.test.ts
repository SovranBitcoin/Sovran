import { describe, expect, test } from 'bun:test';

import { renderConsoleLine } from './consoleFormat';

describe('renderConsoleLine', () => {
  test('passing step line: ok glyph, bracket id, trailing duration', () => {
    const html = renderConsoleLine('    ✓ [step-3] tap Send    450ms');
    expect(html).toContain('class="console-line"');
    expect(html).toContain('<span class="glyph ok">✓</span>');
    expect(html).toContain('<span class="tok-id">[step-3]</span>');
    expect(html).toContain('<span class="tok-dur">450ms</span>');
  });

  test('failing step line gets the fail row tint', () => {
    const html = renderConsoleLine('    ✗ [step-7] expect toast    1.2s');
    expect(html).toContain('class="console-line fail"');
    expect(html).toContain('<span class="glyph fail">✗</span>');
    expect(html).toContain('<span class="tok-dur">1.2s</span>');
  });

  test('error continuation (╰) is a fail row', () => {
    const html = renderConsoleLine('        ╰ selector not found: home.balance');
    expect(html).toContain('class="console-line fail"');
    expect(html).toContain('selector not found: home.balance');
  });

  test('retry line is a warn row with tok-id attempt index', () => {
    const html = renderConsoleLine('    ↺ [#01] attempt 2/3');
    expect(html).toContain('class="console-line warn"');
    expect(html).toContain('<span class="tok-id">[#01]</span>');
  });

  test('scenario begin: section row, id highlighted', () => {
    const html = renderConsoleLine('▶ scenario onboarding.full');
    expect(html).toContain('class="console-line section"');
    expect(html).toContain('<span class="glyph run">▶</span>');
    expect(html).toContain('scenario <span class="tok-id">onboarding.full</span>');
  });

  test('scenario/fixture words mid-sentence are not id-highlighted', () => {
    const html = renderConsoleLine('    ⚠ quarantined: funded scenario failed mid-flight');
    expect(html).not.toContain('<span class="tok-id">failed</span>');
    expect(html).toContain('quarantined: funded scenario failed mid-flight');
  });

  test('phase line highlights the phase label', () => {
    const html = renderConsoleLine('  ▸ TEST START');
    expect(html).toContain('<span class="tok-kind">TEST START</span>');
    expect(renderConsoleLine('  ✓ VERIFY    2.0s')).toContain(
      '<span class="tok-kind">VERIFY</span>'
    );
  });

  test('separator and run summary', () => {
    expect(renderConsoleLine('─'.repeat(48))).toContain('class="console-line sep"');
    expect(
      renderConsoleLine(
        '  3 scenario(s) · ✓ 2  ✗ 1  scenario-skipped 0  ◌ 0  ⏱ 12.3s  funds: clean  proof: product'
      )
    ).toContain('class="console-line section"');
  });

  test('[e2e] meta lines keep their prefix dim-tagged', () => {
    const html = renderConsoleLine('[e2e] funds status: clean (0 blockers)');
    expect(html).toContain('class="console-line meta"');
    expect(html).toContain('<span class="tok-id">[e2e]</span>');
  });

  test('unknown output falls through untouched (but escaped)', () => {
    const html = renderConsoleLine('warn: <Component & Co> deprecated');
    expect(html).toContain('class="console-line"');
    expect(html).toContain('&lt;Component &amp; Co&gt; deprecated');
    expect(html).not.toContain('<Component');
  });

  test('blank line keeps its row height', () => {
    expect(renderConsoleLine('')).toBe('<div class="console-line"> </div>');
  });

  test('label text is escaped inside step lines', () => {
    const html = renderConsoleLine('    ✓ [s1] enter <amount> & confirm    90ms');
    expect(html).toContain('&lt;amount&gt; &amp; confirm');
  });
});
