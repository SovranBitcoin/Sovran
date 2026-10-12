import { describe, it, expect } from 'vitest';
import { decorateEntry } from '../../src/screen-actions/createManager';

describe('decorateEntry token text', () => {
  it('keeps a token that arrives already encoded, as the mint review entry carries it', () => {
    const waitingToken = 'cashuBsynthetic-token-waiting-for-the-mint-to-be-trusted';

    const decorated = decorateEntry(
      { mintUrl: 'https://mint.example.com', token: waitingToken },
      'en',
    );

    expect(String(decorated?.tokenString)).toBe(waitingToken);
  });

  it('has no token text for an entry without a token', () => {
    const decorated = decorateEntry({ mintUrl: 'https://mint.example.com' }, 'en');

    expect(decorated?.tokenString).toBeNull();
  });
});
