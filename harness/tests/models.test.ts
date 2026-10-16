import { expect, test } from 'bun:test';
import { fixture } from './controller.test';
import { Controller } from '../src/controller';
import { dispatch } from '../src/protocol';
import type { RuntimeTask } from '../src/models';
import { assessment, type Task } from '../src/workflow';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fixtureVerification = { version: 1, requirements: [{ kind: 'inspection', requirement: 'behavior', rationale: 'Routing fixture checks controller behavior separately; no product behavior claim' }] };

export function routedModels() {
  const sol = { provider: 'codex', model: 'gpt-6.1-sol', options: { reasoningEffort: 'high' } };
  const astra = { provider: 'codex', model: 'gpt-6-astra', options: { reasoningEffort: 'high' } };
  const opus = { provider: 'claudeAgent', model: 'claude-opus-5-5', options: { effort: 'high' } };
  const route = (...candidates: (typeof sol | typeof opus)[]) => ({ purpose: 'Fixture route', candidates });
  return {
    kind: 'routed', allowGptOnly: true,
    catalog: { observedAt: new Date().toISOString(), providers: [
      { providerInstanceId: 'codex', driverKind: 'codex', canRunChildTask: true,
        models: ['gpt-6.1-sol', 'gpt-6-astra'].map(id => ({ id, options: [
          { id: 'reasoningEffort', type: 'select', options: [{ id: 'high' }, { id: 'medium' }] },
        ] })) },
      { providerInstanceId: 'claudeAgent', driverKind: 'claudeAgent', canRunChildTask: true,
        models: [{ id: 'claude-opus-5-5', options: [{ id: 'effort', type: 'select', options: [{ id: 'high' }] }] }] },
    ] },
    routes: { research: route(sol), implementation: route(sol, opus), review: route(opus, sol),
      adversary: route(opus, sol), audit: route(opus, sol), diversityReview: route(astra) },
  };
}

test('a sealed route dispatches its primary model and explicit supported effort', () => {
  const { controller: c, root, spec } = fixture();
  expect(() => c.create(root, { ...spec, models: routedModels() })).toThrow('pre-edit history policy');
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() });
  expect(c.next(t.id).ticket?.target).toEqual({ provider: 'codex', model: 'gpt-6.1-sol', options: { reasoningEffort: 'high' } });
});

test('unsupported models and effort cannot enter a sealed route', () => {
  const { controller: c, root, spec } = fixture();
  const models = routedModels();
  models.routes.research.candidates = [{ provider: 'codex', model: 'gpt-6.1-sol', options: { reasoningEffort: 'invented' } }];
  expect(() => c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models })).toThrow('Unsupported model option');
  models.routes.research.candidates = [{ provider: 'codex', model: 'missing', options: { reasoningEffort: 'high' } }];
  expect(() => c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models })).toThrow('Unavailable model');
});

function claimed(c: Controller, id: string) {
  const ticket = c.next(id).ticket;
  if (!ticket) throw new Error('Missing ticket');
  const runtime: RuntimeTask = { taskId: `runtime:${ticket.id}`, providerInstanceId: ticket.target.provider,
    model: ticket.target.model, status: 'running', workState: 'working', hasPendingChildRuns: false, hasPendingQuestion: false };
  c.beginDispatch(id, ticket.id, 'coordinator', 'session');
  c.claim(id, ticket.id, runtime.taskId, runtime.providerInstanceId, ticket.target.model, runtime);
  return { ticket, runtime };
}

function completed(c: Controller, t: Task) {
  const { ticket, runtime } = claimed(c, t.id);
  return c.submit(t.id, ticket.id, runtime.taskId, {
    verdict: 'pass', summary: 'Inspected fixture', findings: [],
    ...(ticket.role === 'audit' && t.contract.historyPolicy ? { historyReview: [{ path: 'source.txt', observation: 'Fixture original protection reviewed against current source', evidence: ['source.txt'] }] } : {}),
    ...(ticket.role === 'research' && t.contract.historyPolicy ? { history: [{ path: 'source.txt', owner: 'source.txt', intent: 'recorded',
      reason: 'The initial fixture preserves original text', preserveBy: 'Keep the original fixture value',
      ...Object.fromEntries(['changes', 'callersAndTests', 'priorPRs', 'followups'].map(key => [key, { status: 'gap', explanation: 'Synthetic routing fixture has no app history', evidence: [] }])) }] } : {}),
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'Read fixture source' }],
    reuse: { searched: ['source.txt'], used: ['source.txt'], added: [], removed: [] },
    inspections: c.brief(t.id).packet.artifacts.map(a => ({ ...a, observation: 'Read fixture output' })),
  }, { ...runtime, status: 'completed', workState: 'result_available' });
}

function quota(c: Controller, t: Task) {
  const { ticket, runtime } = claimed(c, t.id);
  return c.fallback(t.id, ticket.id, 'quota-exhausted', {
    ...runtime, status: 'failed', workState: 'result_available', summary: 'Synthetic quota fixture',
  }, 'Synthetic terminal quota result; all child work reconciled');
}

async function reviewStage(c: Controller, t: Task) {
  t = completed(c, t); t = c.seal(t.id, t.policy); t = completed(c, t);
  return c.verify(t.id);
}

test('dispatch reservation survives restart and authorizes exactly one external call', () => {
  const { controller: c, root, state, spec } = fixture();
  const t = c.next(c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() }).id);
  const ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  const first = c.beginDispatch(t.id, ticket.id, 'coordinator', 'session');
  expect(first.dispatchAuthorized).toBe(true);
  const resumed = new Controller(state);
  try {
    expect(resumed.beginDispatch(t.id, ticket.id, 'coordinator', 'session').dispatchAuthorized).toBe(false);
    expect(resumed.read(t.id).ticket?.dispatch).toEqual(first.task.ticket?.dispatch);
    expect(() => resumed.beginDispatch(t.id, ticket.id, 'other', 'session')).toThrow();
  } finally { resumed.close(); }
});

test('quota fallback needs terminal lineage, preserves budget, and cannot accept the old worker', async () => {
  const { controller: c, root, state, spec } = fixture();
  let t = await reviewStage(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() }));
  const { ticket, runtime } = claimed(c, t.id);
  const terminal: RuntimeTask = { ...runtime, status: 'failed', workState: 'result_available', summary: 'Quota fixture' };
  expect(() => c.fallback(t.id, ticket.id, 'quota-exhausted', { ...terminal, hasPendingChildRuns: true }, 'quota')).toThrow('Reconcile');
  expect(() => c.fallback(t.id, ticket.id, 'quota-exhausted', { ...terminal, hasPendingQuestion: true }, 'quota')).toThrow('Reconcile');
  expect(() => c.fallback(t.id, ticket.id, 'quota-exhausted', runtime, 'quota')).toThrow('Reconcile');
  t = c.fallback(t.id, ticket.id, 'quota-exhausted', terminal, 'quota');
  expect(t.ticket?.target.model).toBe('gpt-6.1-sol');
  expect(t.ticket?.id).not.toBe(ticket.id);
  expect(t.generation).toBe(0); expect(t.contract.limits).toEqual(spec.limits);
  const resumed = new Controller(state);
  try {
    expect(resumed.fallback(t.id, ticket.id, 'quota-exhausted', terminal, 'quota').ticket?.id).toBe(t.ticket?.id);
    expect(resumed.read(t.id).attempts.at(-1)?.completion.kind).toBe('unavailable');
  } finally { resumed.close(); }
  expect(() => c.submit(t.id, ticket.id, runtime.taskId, {
    verdict: 'pass', summary: 'Late result', findings: [], observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'late' }],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] },
  }, { ...terminal, status: 'completed' })).toThrow('stale ticket');
});

test('GPT-only reviews require a separate fresh model slot after every normal review', async () => {
  const { controller: c, root, spec } = fixture();
  const models = routedModels();
  models.routes.research = models.routes.review; // Claude research must not waive review diversity.
  let t = await reviewStage(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models }));
  t = quota(c, t); t = completed(c, t); expect(t.phase).toBe('adversarial');
  t = quota(c, t); t = completed(c, t); expect(t.phase).toBe('auditing');
  t = await c.verify(t.id, true); t = quota(c, t); t = completed(c, t);
  expect(t.phase).toBe('diversityReviewing');
  expect(c.next(t.id).ticket?.target.model).toBe('gpt-6-astra');
  t = completed(c, t); expect(t.phase).toBe('publishable');
  expect(t.attempts.filter(a => a.ticket.role === 'diversityReview')).toHaveLength(1);
});

function claudeOnlyModels(allowClaudeOnly: boolean) {
  const models = routedModels();
  const [sol, opus] = models.routes.implementation.candidates;
  const astra = models.routes.diversityReview.candidates[0];
  if (!sol || !opus || !astra) throw new Error('Missing fixture targets');
  const fable = { provider: 'claudeAgent', model: 'claude-fable-5-1', options: { effort: 'high' } };
  models.catalog.providers[1]?.models.push({ id: 'claude-fable-5-1', options: [{ id: 'effort', type: 'select', options: [{ id: 'high' }] }] });
  const route = (...candidates: (typeof sol)[]) => ({ purpose: 'Fixture route', candidates });
  return { ...models, allowClaudeOnly,
    routes: { ...models.routes, research: route(opus), adversary: route(fable),
      // The author model is listed first to prove it can never take the extra slot.
      diversityReview: route(opus, astra, fable) } };
}

test('Claude-only completion needs an extra review by a Claude model outside the author set', async () => {
  const { controller: c, root, spec } = fixture();
  let t = completed(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: claudeOnlyModels(true) }));
  t = c.seal(t.id, t.policy); t = quota(c, t);
  expect(t.ticket?.target.model).toBe('claude-opus-5-5');
  t = completed(c, t); t = await c.verify(t.id);
  t = completed(c, t); t = completed(c, t);
  t = await c.verify(t.id, true); t = completed(c, t);
  expect(t.phase).toBe('diversityReviewing');
  expect(c.next(t.id).ticket?.target.model).toBe('gpt-6-astra');
  t = quota(c, t);
  expect(t.ticket?.target.model).toBe('claude-fable-5-1');
  t = completed(c, t); expect(t.phase).toBe('publishable');
});

test('a GPT-only policy sealed before Claude-only approval cannot finish on a Claude extra review', async () => {
  const { controller: c, root, spec } = fixture();
  const { allowClaudeOnly: _absent, ...models } = claudeOnlyModels(false);
  let t = completed(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models }));
  t = c.seal(t.id, t.policy); t = quota(c, t); t = completed(c, t); t = await c.verify(t.id);
  t = completed(c, t); t = completed(c, t);
  t = await c.verify(t.id, true); t = completed(c, t);
  expect(t.phase).toBe('diversityReviewing');
  t = quota(c, t);
  expect(t.phase).toBe('incomplete');
  expect(t.reason).toContain('No eligible authorized model');
});

test('a partial failed author remains excluded from extra review and its edits are retained', async () => {
  const { controller: c, root, spec } = fixture();
  const models = routedModels();
  const astra = models.routes.diversityReview.candidates[0];
  const sol = models.routes.research.candidates[0];
  if (!astra || !sol) throw new Error('Missing fixture targets');
  models.routes.implementation.candidates = [astra, sol];
  let t = completed(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models })); t = c.seal(t.id, t.policy);
  const { ticket, runtime } = claimed(c, t.id);
  writeFileSync(join(root, 'source.txt'), 'Partial implementation retained');
  t = c.fallback(t.id, ticket.id, 'quota-exhausted', { ...runtime, status: 'failed', workState: 'result_available' }, 'quota');
  expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('Partial implementation retained');
  expect(t.attempts.at(-1)?.ticket.target.model).toBe('gpt-6-astra');
  t = completed(c, t); t = await c.verify(t.id);
  t = completed(c, quota(c, t)); t = completed(c, quota(c, t));
  t = await c.verify(t.id, true); t = completed(c, quota(c, t));
  expect(t.phase).toBe('diversityReviewing');
  t = c.next(t.id);
  expect(t.phase).toBe('incomplete');
  expect(t.reason).toContain('No eligible authorized model');
});

test('negative review enters repair and cannot shop for a replacement verdict', async () => {
  const { controller: c, root, state, spec } = fixture();
  let t = await reviewStage(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() }));
  const { ticket, runtime } = claimed(c, t.id);
  t = c.submit(t.id, ticket.id, runtime.taskId, {
    verdict: 'fail', summary: 'Fixture defect', findings: [{ id: 'defect', severity: 'blocking', evidence: 'source.txt', detail: 'Fixture counterexample' }],
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'Counterexample' }],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] },
  }, { ...runtime, status: 'completed', workState: 'result_available' });
  expect(t.phase).toBe('implementing'); expect(t.generation).toBe(1);
  expect(() => c.fallback(t.id, ticket.id, 'quota-exhausted', { ...runtime, status: 'failed', workState: 'result_available' }, 'quota')).toThrow('No routed attempt');
  c.next(t.id);
  expect(c.brief(t.id).packet.reconciliation?.obligations).toMatchObject([{ detail: 'Fixture counterexample' }]);
  const historical = t.history[0]?.artifacts[0];
  if (!historical) throw new Error('Missing repair log');
  const original = readFileSync(join(state, t.id, historical.path));
  writeFileSync(join(state, t.id, historical.path), 'forged history');
  const repair = claimed(c, t.id);
  const result = { verdict: 'pass', summary: 'Repaired', findings: [],
    observations: [{ requirement: 'behavior', evidence: `artifact:${historical.path}`, observation: 'Read old failure' }],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] } };
  const terminal: RuntimeTask = { ...repair.runtime, status: 'completed', workState: 'result_available' };
  expect(() => c.submit(t.id, repair.ticket.id, repair.runtime.taskId, result, terminal)).toThrow('Evidence changed');
  writeFileSync(join(state, t.id, historical.path), original);
  t = c.submit(t.id, repair.ticket.id, repair.runtime.taskId, result, terminal);
  t = await c.verify(t.id); c.next(t.id);
  expect(c.brief(t.id).packet.repairReason).toBe('');
});

test('a prior generation Claude pass does not waive fresh diversity review on unchanged bytes', async () => {
  const { controller: c, root, spec } = fixture();
  let t = await reviewStage(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() }));
  t = completed(c, t); // Accepted Claude review in generation zero.
  t = c.repair(t.id, 'Repeat with a stronger test obligation');
  t = completed(c, t); t = await c.verify(t.id);
  t = completed(c, quota(c, t)); t = completed(c, quota(c, t));
  t = await c.verify(t.id, true); t = completed(c, quota(c, t));
  expect(t.generation).toBe(1); expect(t.phase).toBe('diversityReviewing');
});

test('cancelled availability work is reconciled without reopening or dispatching a successor', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() });
  const { ticket, runtime } = claimed(c, t.id);
  c.stop(t.id, 'cancel', 'Cancelled fixture', true);
  const stopped = c.fallback(t.id, ticket.id, 'quota-exhausted', { ...runtime, status: 'failed', workState: 'result_available' }, 'quota');
  expect(stopped.phase).toBe('cancelled'); expect(stopped.ticket).toBeNull();
  expect(stopped.attempts.at(-1)?.completion.kind).toBe('unavailable');
});

test('routed claims and completion require actual matching runtime identity and terminal work', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.next(c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() }).id);
  const ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  expect(() => c.claim(t.id, ticket.id, 'self-declared', ticket.target.provider, ticket.target.model)).toThrow('Reserve dispatch');
  c.beginDispatch(t.id, ticket.id, 'coordinator', 'session');
  expect(() => c.claim(t.id, ticket.id, 'self-declared', ticket.target.provider, ticket.target.model)).toThrow('runtime identity');
  const { runtime } = claimed(c, t.id);
  expect(() => c.submit(t.id, ticket.id, runtime.taskId, {
    verdict: 'pass', summary: 'Premature', findings: [],
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'premature' }],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] },
  }, { ...runtime, status: 'completed', workState: 'result_available', hasPendingChildRuns: true })).toThrow('Reconcile');
});

test.each([false, true])('legacy journal claim and submission inputs replay (explicit null runtime: %s)', (explicitNull) => {
  const { controller: c, root, spec } = fixture();
  const t = c.next(c.create(root, spec).id);
  const ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  const oldClaim = { ticketId: ticket.id, worker: 'old-worker', provider: ticket.target.provider, model: ticket.target.model,
    ...(explicitNull ? { runtime: null } : {}) };
  c.journal.change(t.id, `claim:${ticket.id}:old-worker`, oldClaim, () => ({
    ...t, ticket: { ...ticket, claim: { worker: 'old-worker', provider: ticket.target.provider, model: ticket.target.model } },
  }));
  expect(c.claim(t.id, ticket.id, 'old-worker', ticket.target.provider, ticket.target.model).ticket?.claim?.worker).toBe('old-worker');
  const result = assessment.parse({ verdict: 'pass', summary: 'Old accepted research', findings: [],
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'original retained' }],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] } });
  c.journal.change(t.id, `submit:${ticket.id}`, { worker: 'old-worker', result, ...(explicitNull ? { runtime: null } : {}) }, value => ({ ...value, ticket: null, phase: 'intake' }));
  expect(c.submit(t.id, ticket.id, 'old-worker', result).phase).toBe('intake');
  expect(() => c.submit(t.id, ticket.id, 'old-worker', { ...result, summary: 'Changed result' })).toThrow('different input');
  expect(() => c.submit(t.id, ticket.id, 'old-worker', result, {
    taskId: 'old-worker', providerInstanceId: ticket.target.provider, model: ticket.target.model,
    status: 'completed', workState: 'result_available', hasPendingChildRuns: false, hasPendingQuestion: false,
  })).toThrow('different input');
});

test('mixed source authors cannot be certified by only one author provider', async () => {
  const { controller: c, root, spec } = fixture();
  let t = completed(c, c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models: routedModels() })); t = c.seal(t.id, t.policy);
  t = quota(c, t); // Sol may have written; Opus is the replacement author.
  t = completed(c, t); t = await c.verify(t.id);
  t = completed(c, t); t = completed(c, t); t = await c.verify(t.id, true); t = completed(c, t);
  expect(t.phase).toBe('diversityReviewing');
  t = completed(c, t); expect(t.phase).toBe('publishable');
});

test('a definitive rejection before child creation permits only the next sealed candidate', async () => {
  const { controller: c, root, spec } = fixture();
  const models = routedModels(); models.routes.research = models.routes.implementation;
  const t = c.next(c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] }, verificationPolicy: fixtureVerification, models }).id);
  const ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  const reserved = c.beginDispatch(t.id, ticket.id, 'coordinator', 'session');
  const rejection = { kind: 'definitively-not-created', requestId: reserved.task.ticket?.dispatch?.requestId,
    evidence: { code: 'model_unavailable', message: 'Synthetic rejection before child creation' } };
  await dispatch(c, { action: 'dispatch-rejected', id: t.id, ticket: ticket.id, reason: 'model-unavailable', rejection });
  const next = c.read(t.id);
  expect(next.ticket?.target.model).toBe('claude-opus-5-5');
  expect(next.attempts.at(-1)?.ticket.claim).toBeNull();
  expect(next.generation).toBe(0);
  expect(next.contract.limits).toEqual(spec.limits);
  await expect(dispatch(c, { action: 'dispatch-rejected', id: t.id, ticket: next.ticket?.id,
    reason: 'model-unavailable', rejection: { ...rejection, kind: 'unknown' } })).rejects.toThrow();
});
