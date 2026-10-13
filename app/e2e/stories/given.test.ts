import { expect, test } from 'bun:test';
import { withGiven } from './given';
import { storySchema } from './story';

const story = (given: unknown, text: string) =>
  storySchema.parse({
    id: 'pay-a-lightning-invoice',
    purpose: 'A person pays a Lightning invoice someone gave them and sees it paid.',
    startsFrom: 'fresh',
    ...(given ? { given } : {}),
    steps: [{ name: 'type the invoice', type: { text }, expect: [{ page: 'SendScreen' }] }],
  });

test('an invoice is fetched for the story and typed where the story marks it', async () => {
  const asked: [string, number][] = [];
  const ready = await withGiven(
    story({ invoice: { mint: 'https://testnut.cashu.space', sats: 10 } }, '{{invoice}}'),
    async (mint, sats) => {
      asked.push([mint, sats]);
      return 'lnbc100n1example';
    }
  );

  expect(asked).toEqual([['https://testnut.cashu.space', 10]]);
  expect(ready.steps[0].type?.text).toBe('lnbc100n1example');
});

test('a story given nothing is left as written and nothing is fetched', async () => {
  const ready = await withGiven(story(undefined, 'hello'), async () => {
    throw new Error('should not be asked');
  });

  expect(ready.steps[0].type?.text).toBe('hello');
});

test('a mark for something the story was not given is refused', async () => {
  await expect(withGiven(story(undefined, '{{invoice}}'))).rejects.toThrow(
    /types \{\{invoice\}\} but was given no invoice/
  );
});
