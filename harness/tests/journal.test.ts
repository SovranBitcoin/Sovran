import { expect, test } from 'bun:test';
import { Journal } from '../src/journal';

test('a rejected or replayed operation cannot advance durable work', () => {
  const journal = new Journal(':memory:');
  try {
    journal.create('task', { phase: 'intake' });
    journal.change('task', 'seal', { action: 'seal' }, value => ({ ...value, phase: 'implementing' }));
    expect(journal.read('task')).toEqual({ revision: 1, value: { phase: 'implementing' } });
    journal.change('task', 'seal', { action: 'seal' }, () => { throw new Error('must not replay'); });
    expect(journal.read('task').revision).toBe(1);
    expect(() => journal.change('task', 'seal', { action: 'publish' }, v => v)).toThrow('different input');
    expect(() => journal.change('task', 'reject', {}, () => { throw new Error('failed gate'); })).toThrow('failed gate');
    expect(journal.read('task').revision).toBe(1);
  } finally { journal.close(); }
});
