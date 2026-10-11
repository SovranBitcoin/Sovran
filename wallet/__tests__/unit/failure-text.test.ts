import { describe, expect, it } from 'vitest';

import { AuthoredError, failureText } from '../../src/errors';
import { LnurlError } from '../../src/lnurl';

describe('failureText', () => {
  it("marks this package's own messages as safe to show", () => {
    expect(failureText(new AuthoredError('No accepted mints'), 'x')).toEqual({
      message: 'No accepted mints',
      authored: true,
    });
    expect(
      failureText(new LnurlError('LNURL_INVALID_TARGET', 'Invalid LNURL or lightning address'), 'x'),
    ).toMatchObject({ authored: true });
  });

  it("does not vouch for another library's or a mint's wording", () => {
    expect(failureText(new Error('upstream said: <html>502</html>'), 'x')).toEqual({
      message: 'upstream said: <html>502</html>',
      authored: false,
    });
  });

  it('uses the fallback, which the caller wrote, when nothing readable was thrown', () => {
    expect(failureText('boom', 'Payment failed')).toEqual({
      message: 'Payment failed',
      authored: true,
    });
    expect(failureText(undefined, 'Payment failed').authored).toBe(true);
  });
});
