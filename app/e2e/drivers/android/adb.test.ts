import { describe, expect, it } from 'bun:test';
import { extractUiautomatorXml } from './adb';

describe('extractUiautomatorXml', () => {
  it('extracts the XML tree without a trailing status line', () => {
    expect(extractUiautomatorXml('noise\n<?xml version="1.0"?><hierarchy />\nUI dumped')).toBe(
      '<?xml version="1.0"?><hierarchy />'
    );
  });

  it('never embeds malformed raw AX output in its error', () => {
    const rawPrivateOutput = 'raw-private-ax-output';

    expect(() => extractUiautomatorXml(rawPrivateOutput)).toThrow(
      `dump produced no XML (${rawPrivateOutput.length} bytes)`
    );
    try {
      extractUiautomatorXml(rawPrivateOutput);
    } catch (error) {
      expect(String(error)).not.toContain(rawPrivateOutput);
    }
  });
});
