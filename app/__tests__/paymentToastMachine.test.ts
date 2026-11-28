/**
 * @jest-environment node
 *
 * The payment toast state machine, on fake timers: what is on screen at every
 * moment for one payment, for overlapping payments, and for a payment in steps.
 */

import {
  createPaymentToastMachine,
  TOAST_TIMING,
  type ToastView,
} from '@/shared/lib/popup/paymentToastMachine';

const { spinnerDelayMs, minVisibleMs, resultMs, closeAfterMs, workingMaxMs } = TOAST_TIMING;

function setup() {
  const changes: ToastView<string>[][] = [];
  const finished: string[] = [];
  const machine = createPaymentToastMachine<string>({
    onChange: (views) => changes.push(views),
    onFinished: ({ key, phase }) => finished.push(`${key}:${phase}`),
  });
  /** What is on screen now, as `key:phase:content`. */
  const screen = () => machine.views().map((v) => `${v.key}:${v.phase}:${v.content}`);
  /** Every state the toast `key` has ever drawn, in order, without repeats. */
  const drawn = (key: string) => {
    const seen: string[] = ['hidden'];
    for (const views of changes) {
      const view = views.find((v) => v.key === key);
      const label = view ? `${view.phase}:${view.content}` : 'hidden';
      if (seen[seen.length - 1] !== label) seen.push(label);
    }
    return seen;
  };
  return { machine, screen, drawn, changes, finished };
}

const advance = (ms: number) => jest.advanceTimersByTime(ms);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('one payment', () => {
  it('shows no spinner when the result arrives within the spinner delay', () => {
    const { machine, screen, drawn } = setup();
    machine.start('melt:q1', 'pay');
    expect(screen()).toEqual([]);
    advance(spinnerDelayMs - 1);
    expect(screen()).toEqual([]);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:done:paid']);
    advance(resultMs + 1000);
    expect(drawn('melt:q1')).toEqual(['hidden', 'done:paid', 'hidden']);
  });

  it('spins once the delay passes, and holds each state a minimum time', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs);
    expect(screen()).toEqual(['melt:q1:working:pay']);
    // The result lands 100 ms after the spinner appeared: the spinner stays
    // its minimum, then the result replaces it.
    advance(100);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:working:pay']);
    advance(minVisibleMs - 100 - 1);
    expect(screen()).toEqual(['melt:q1:working:pay']);
    advance(1);
    expect(screen()).toEqual(['melt:q1:done:paid']);
  });

  it('keeps a result on screen for exactly its time, then never replays it', () => {
    const { machine, screen, finished } = setup();
    machine.report('melt:q1', 'done', 'paid');
    advance(resultMs - 1);
    expect(screen()).toEqual(['melt:q1:done:paid']);
    advance(1);
    expect(screen()).toEqual([]);
    expect(finished).toEqual(['melt:q1:done']);
    // The same result delivered again (a replayed wallet event) is not shown.
    machine.report('melt:q1', 'done', 'paid');
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs);
    expect(screen()).toEqual([]);
  });

  it('does not restart a result timer when more is learned about the same result', () => {
    const { machine, screen } = setup();
    machine.report('melt:q1', 'done', 'paid');
    advance(resultMs - 500);
    machine.report('melt:q1', 'done', 'paid, with id');
    expect(screen()).toEqual(['melt:q1:done:paid, with id']);
    advance(500);
    expect(screen()).toEqual([]);
  });

  it('stops spinning once handed off, says so, and closes itself', () => {
    const { machine, screen, finished } = setup();
    machine.start('send:op1', 'request');
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('send:op1', 'handed-off', 'waiting for recipient');
    expect(screen()).toEqual(['send:op1:handed-off:waiting for recipient']);
    advance(closeAfterMs);
    expect(screen()).toEqual([]);
    // Hours later the recipient claims: the result is still told, once.
    advance(5 * 60 * 60 * 1000);
    expect(finished).toEqual([]);
    machine.report('send:op1', 'done', 'claimed');
    expect(screen()).toEqual(['send:op1:done:claimed']);
    advance(resultMs);
    expect(finished).toEqual(['send:op1:done']);
  });

  it('never spins longer than the working maximum: it turns slow and closes', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs + workingMaxMs - 1);
    expect(screen()).toEqual(['melt:q1:working:pay']);
    advance(1);
    expect(screen()).toEqual(['melt:q1:slow:pay']);
    advance(closeAfterMs);
    expect(screen()).toEqual([]);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:done:paid']);
  });

  it('turns slow at the moment its caller named, when that is sooner', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay', { slowAt: Date.now() + 5000 });
    advance(4999);
    expect(screen()).toEqual(['melt:q1:working:pay']);
    advance(1);
    expect(screen()).toEqual(['melt:q1:slow:pay']);
  });

  it('takes a later, sooner slow moment for a spinner already on screen', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs);
    machine.report('melt:q1', 'working', 'pay', { slowAt: Date.now() + 2000 });
    advance(1999);
    expect(screen()).toEqual(['melt:q1:working:pay']);
    advance(1);
    expect(screen()).toEqual(['melt:q1:slow:pay']);
  });

  it('answers what is known about a payment whether or not its toast is on screen', () => {
    const { machine } = setup();
    expect(machine.get('melt:q1')).toBeUndefined();
    machine.start('melt:q1', 'pay');
    expect(machine.views()).toEqual([]);
    expect(machine.get('melt:q1')).toEqual({ key: 'melt:q1', phase: 'working', content: 'pay' });
    expect(machine.tracked()).toEqual([{ key: 'melt:q1', phase: 'working', content: 'pay' }]);
    machine.report('melt:q1', 'done', 'paid');
    advance(resultMs);
    expect(machine.get('melt:q1')).toBeUndefined();
    expect(machine.tracked()).toEqual([]);
  });

  it('lets a late success correct a failure still on screen', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('melt:q1', 'failed', 'no reply');
    expect(screen()).toEqual(['melt:q1:failed:no reply']);
    advance(minVisibleMs);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:done:paid']);
    // The success gets its own full time on screen.
    advance(resultMs - 1);
    expect(screen()).toEqual(['melt:q1:done:paid']);
    advance(1);
    expect(screen()).toEqual([]);
  });

  it('shows a late success after its failure toast has closed, and never the reverse', () => {
    const { machine, screen } = setup();
    machine.report('melt:q1', 'failed', 'no reply');
    advance(resultMs);
    expect(screen()).toEqual([]);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:done:paid']);
    // A failure reported after the success changes nothing, now or later.
    machine.report('melt:q1', 'failed', 'stale');
    expect(screen()).toEqual(['melt:q1:done:paid']);
    advance(resultMs);
    machine.report('melt:q1', 'failed', 'stale');
    expect(screen()).toEqual([]);
  });

  it('only moves forward: a finished or handed-off payment does not spin again', () => {
    const { machine, screen } = setup();
    machine.report('send:op1', 'handed-off', 'waiting');
    machine.report('send:op1', 'working', 'sending');
    advance(minVisibleMs);
    expect(screen()).toEqual(['send:op1:handed-off:waiting']);
    machine.report('send:op1', 'done', 'claimed');
    advance(minVisibleMs);
    machine.report('send:op1', 'slow', 'slow');
    machine.report('send:op1', 'handed-off', 'waiting');
    expect(screen()).toEqual(['send:op1:done:claimed']);
  });

  it('starts afresh when a failed payment is tried again', () => {
    const { machine, screen } = setup();
    machine.start('receive:t1', 'redeem');
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('receive:t1', 'failed', 'offline');
    advance(resultMs);
    machine.start('receive:t1', 'redeem');
    advance(spinnerDelayMs);
    expect(screen()).toEqual(['receive:t1:working:redeem']);
  });

  it('is started once, however often its start is reported', () => {
    const { machine, screen, changes } = setup();
    machine.start('mint:q1', 'receiving');
    advance(spinnerDelayMs);
    machine.start('mint:q1', 'receiving');
    machine.start('mint:q1', 'receiving');
    expect(screen()).toEqual(['mint:q1:working:receiving']);
    expect(changes).toHaveLength(1);
  });
});

describe('cancel, clear and the person', () => {
  it('dismisses a cancelled payment at once, before or after its spinner shows', () => {
    const { machine, screen, finished } = setup();
    machine.start('pending:a', 'pay');
    machine.dismiss('pending:a');
    advance(spinnerDelayMs * 2);
    expect(screen()).toEqual([]);

    machine.start('pending:b', 'pay');
    advance(spinnerDelayMs);
    expect(screen()).toEqual(['pending:b:working:pay']);
    machine.report('pending:b', 'cancelled', 'pay');
    expect(screen()).toEqual([]);
    advance(workingMaxMs * 2);
    expect(screen()).toEqual([]);
    expect(finished).toEqual([]);
  });

  it('dismisses every toast and forgets everything on a profile switch', () => {
    const { machine, screen } = setup();
    machine.report('mint:q2', 'done', 'received');
    advance(resultMs);
    machine.start('melt:q1', 'pay');
    machine.report('mint:q3', 'done', 'received');
    advance(spinnerDelayMs);
    expect(screen()).toHaveLength(2);
    machine.dismissAll();
    expect(screen()).toEqual([]);
    advance(workingMaxMs * 2);
    expect(screen()).toEqual([]);
    // Nothing of the old profile is remembered: the same key can show again.
    machine.report('mint:q2', 'done', 'received');
    expect(screen()).toEqual(['mint:q2:done:received']);
  });

  it('still tells the result of a toast the person swiped away mid-flight, and only the result', () => {
    const { machine, screen } = setup();
    machine.start('melt:q1', 'pay');
    advance(spinnerDelayMs);
    machine.userDismissed(machine.views()[0]!.id);
    expect(screen()).toEqual([]);
    machine.report('melt:q1', 'handed-off', 'waiting');
    expect(screen()).toEqual([]);
    advance(workingMaxMs);
    expect(screen()).toEqual([]);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual(['melt:q1:done:paid']);
  });

  it('is finished with once the person swipes a result away', () => {
    const { machine, screen, finished } = setup();
    machine.report('melt:q1', 'done', 'paid');
    machine.userDismissed(machine.views()[0]!.id);
    expect(screen()).toEqual([]);
    expect(finished).toEqual(['melt:q1:done']);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toEqual([]);
  });
});

describe('overlapping payments', () => {
  it('gives two payments two toasts that never touch each other', () => {
    const { machine, screen } = setup();
    machine.start('melt:send', 'pay');
    advance(spinnerDelayMs);
    machine.start('mint:receive', 'receiving');
    advance(spinnerDelayMs);
    expect(screen()).toEqual(['melt:send:working:pay', 'mint:receive:working:receiving']);

    advance(minVisibleMs);
    machine.report('mint:receive', 'done', 'received');
    expect(screen()).toEqual(['melt:send:working:pay', 'mint:receive:done:received']);
    advance(resultMs);
    // The receive is gone; the send still spins, and still gets its own result.
    expect(screen()).toEqual(['melt:send:working:pay']);
    machine.report('melt:send', 'done', 'paid');
    expect(screen()).toEqual(['melt:send:done:paid']);
    advance(resultMs);
    expect(screen()).toEqual([]);
  });

  it('does not let another toast appearing or leaving move a result timer', () => {
    const { machine, screen } = setup();
    machine.report('melt:a', 'done', 'paid');
    advance(1000);
    machine.report('mint:b', 'done', 'received');
    advance(1000);
    machine.start('melt:c', 'pay');
    machine.dismiss('melt:c');
    advance(999);
    expect(screen()).toEqual(['melt:a:done:paid', 'mint:b:done:received']);
    advance(1);
    expect(screen()).toEqual(['mint:b:done:received']);
    advance(1000);
    expect(screen()).toEqual([]);
  });

  it('keeps the toast and its id when the starter key is bound to the payment', () => {
    const { machine, screen } = setup();
    machine.start('pending:x', 'request', { unbound: { group: 'send' } });
    advance(spinnerDelayMs);
    const id = machine.views()[0]!.id;
    machine.bind('pending:x', 'send:op1');
    expect(machine.views()[0]).toMatchObject({ id, key: 'send:op1', phase: 'working' });
    advance(minVisibleMs);
    machine.report('send:op1', 'done', 'claimed');
    expect(screen()).toEqual(['send:op1:done:claimed']);
    expect(machine.views()[0]!.id).toBe(id);
  });

  it('holds a result that may belong to a toast not yet bound, and lands it there', () => {
    const { machine, screen } = setup();
    machine.start('pending:x', 'request', { unbound: { group: 'send' } });
    advance(spinnerDelayMs + minVisibleMs);
    // The send finished before its flow told the toast which send it is.
    machine.report('send:op1', 'done', 'claimed', { holdForGroup: 'send' });
    expect(screen()).toEqual(['pending:x:working:request']);
    machine.bind('pending:x', 'send:op1');
    expect(screen()).toEqual(['send:op1:done:claimed']);
  });

  it('merges the early result into what the bound toast showed, when told how', () => {
    const changes: ToastView<string>[][] = [];
    const machine = createPaymentToastMachine<string>({
      onChange: (views) => changes.push(views),
      merge: (own, early) => `${own}+${early}`,
    });
    machine.start('pending:x', 'request', { unbound: { group: 'send' } });
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('send:op1', 'done', 'claimed', { holdForGroup: 'send' });
    machine.bind('pending:x', 'send:op1');
    expect(machine.views().map((v) => v.content)).toEqual(['request+claimed']);
  });

  it('gives a held result its own toast when it was another payment after all', () => {
    const { machine, screen } = setup();
    machine.start('pending:x', 'request', { unbound: { group: 'send' } });
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('send:other', 'done', 'claimed', { holdForGroup: 'send' });
    expect(screen()).toEqual(['pending:x:working:request']);
    machine.bind('pending:x', 'send:op1');
    expect(screen()).toEqual(['send:op1:working:request', 'send:other:done:claimed']);
  });

  it('releases a held result when the unbound toast ends without being bound', () => {
    const { machine, screen } = setup();
    machine.start('pending:x', 'request', { unbound: { group: 'send' } });
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('send:other', 'done', 'claimed', { holdForGroup: 'send' });
    machine.report('pending:x', 'failed', 'could not send');
    expect(screen()).toEqual(['pending:x:failed:could not send', 'send:other:done:claimed']);
  });

  it('merges into the starter toast a result that got a toast of its own first', () => {
    const { machine, screen } = setup();
    machine.start('pending:x', 'pay', { unbound: { group: 'melt' } });
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('melt:q1', 'done', 'paid');
    expect(screen()).toHaveLength(2);
    machine.bind('pending:x', 'melt:q1');
    expect(screen()).toEqual(['melt:q1:done:paid']);
  });
});

describe('a payment in steps (swap, rebalance)', () => {
  it('is one toast whose wording follows the current step', () => {
    const { machine, drawn } = setup();
    machine.start('swap:g1', 'Moving to Mint B');
    advance(spinnerDelayMs + 30_000);
    machine.report('swap:g1', 'working', 'Moving to Mint C');
    advance(30_000);
    // No "1 of 2": a toast only ever shows the step it is on.
    machine.report('swap:g1', 'done', 'Swap complete');
    advance(resultMs);
    expect(drawn('swap:g1')).toEqual([
      'hidden',
      'working:Moving to Mint B',
      'working:Moving to Mint C',
      'done:Swap complete',
      'hidden',
    ]);
  });

  it('merges a final step that completes at once into the result', () => {
    const { machine, drawn } = setup();
    machine.start('swap:g1', 'Step one');
    // A long first step, then the last step starts and ends within a moment.
    advance(spinnerDelayMs + 45_000);
    machine.report('swap:g1', 'working', 'Step two');
    advance(40);
    machine.report('swap:g1', 'done', 'Swap complete');
    advance(resultMs);
    // "Step two" is never drawn: the toast goes from the long step to the result.
    expect(drawn('swap:g1')).toEqual([
      'hidden',
      'working:Step one',
      'done:Swap complete',
      'hidden',
    ]);
  });

  it('draws the next step only once it has lasted the spinner delay', () => {
    const { machine, screen } = setup();
    machine.start('swap:g1', 'Step one');
    advance(spinnerDelayMs + 45_000);
    machine.report('swap:g1', 'working', 'Step two');
    advance(spinnerDelayMs - 1);
    expect(screen()).toEqual(['swap:g1:working:Step one']);
    advance(1);
    expect(screen()).toEqual(['swap:g1:working:Step two']);
  });

  it('never draws steps that all end inside one minimum-visible window', () => {
    const { machine, drawn } = setup();
    machine.start('swap:g1', 'Step one');
    advance(spinnerDelayMs);
    advance(50);
    machine.report('swap:g1', 'working', 'Step two');
    advance(50);
    machine.report('swap:g1', 'working', 'Step three');
    advance(50);
    machine.report('swap:g1', 'done', 'Swap complete');
    advance(minVisibleMs + resultMs);
    expect(drawn('swap:g1')).toEqual([
      'hidden',
      'working:Step one',
      'done:Swap complete',
      'hidden',
    ]);
  });

  it('does not replay a completed step when it is reported again', () => {
    const { machine, drawn } = setup();
    machine.start('swap:g1', 'Step one');
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('swap:g1', 'working', 'Step two');
    advance(spinnerDelayMs + minVisibleMs);
    machine.report('swap:g1', 'done', 'Swap complete');
    machine.report('swap:g1', 'working', 'Step one');
    machine.report('swap:g1', 'working', 'Step two');
    advance(minVisibleMs + resultMs);
    expect(drawn('swap:g1')).toEqual([
      'hidden',
      'working:Step one',
      'working:Step two',
      'done:Swap complete',
      'hidden',
    ]);
  });
});

describe('the transaction screen in front', () => {
  it('shows no toast for the transaction whose screen is focused', () => {
    const { machine, screen } = setup();
    machine.setFocus({ token: 'screen-1', ids: ['q1'] });
    machine.start('mint:q1', 'receiving', { ids: ['q1'] });
    advance(spinnerDelayMs);
    machine.report('mint:q1', 'done', 'received');
    advance(minVisibleMs);
    expect(screen()).toEqual([]);
    // Another payment's toast is not affected.
    machine.report('melt:q9', 'done', 'paid', { ids: ['q9'] });
    expect(screen()).toEqual(['melt:q9:done:paid']);
  });

  it('stays quiet for a payment started from the focused screen before its ids are known', () => {
    const { machine, screen } = setup();
    machine.setFocus({ token: 'screen-1', ids: ['preview-entry'] });
    machine.start('pending:x', 'pay', { fromFocus: true, unbound: { group: 'melt' } });
    advance(spinnerDelayMs);
    expect(screen()).toEqual([]);
    // A toast started elsewhere while that screen is up is shown.
    machine.start('pending:y', 'pay');
    advance(spinnerDelayMs);
    expect(screen()).toEqual(['pending:y:working:pay']);
  });

  it('shows the toast once the screen is left, if its time is not up', () => {
    const { machine, screen } = setup();
    machine.setFocus({ token: 'screen-1', ids: ['q1'] });
    machine.report('mint:q1', 'done', 'received', { ids: ['q1'] });
    advance(1000);
    machine.setFocus(null);
    expect(screen()).toEqual(['mint:q1:done:received']);
    // Its time ran while hidden: it closes when it would have anyway.
    advance(resultMs - 1000);
    expect(screen()).toEqual([]);
  });

  it('hides a toast already on screen when its transaction screen is opened', () => {
    const { machine, screen } = setup();
    machine.report('mint:q1', 'done', 'received', { ids: ['q1'] });
    expect(screen()).toHaveLength(1);
    machine.setFocus({ token: 'screen-1', ids: ['q1'] });
    expect(screen()).toEqual([]);
  });

  it('matches ids learned after the toast started', () => {
    const { machine, screen } = setup();
    machine.setFocus({ token: 'screen-1', ids: ['op-7'] });
    machine.start('pending:x', 'pay');
    advance(spinnerDelayMs);
    expect(screen()).toHaveLength(1);
    machine.bind('pending:x', 'send:op-7', ['op-7']);
    expect(screen()).toEqual([]);
  });
});
