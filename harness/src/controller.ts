import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { Journal } from './journal';
import { inspectNodeTests, isNativeCheck, isNodeCheck, regression, validateVerification } from './checks';
import { inspectNativeStories, nativeRunnerChanges } from './native';
import { runCommand } from './command';
import { inspectChange } from './policy';
import { inspectUpgradeEvidence, upgradeInventorySchema, upgradeReceiptSummary } from './upgrade';
import { brief } from './brief';
import { assessmentArtifacts, inspected, unresolved, validateResolutions } from './evidence';
import { Publisher, publishPlan } from './publisher';
import { captureHistory, inspectHistoricalReference, validateHistory } from './history';
import { contextPaths } from './context';
import { prepareReference } from './references';
import { availability, candidates, dispatchRejection, driver, OUTAGE_MS, outage, runtimeTask, type Model, type Outage, type RuntimeTask } from './models';
import { assessment, contract, move, roleFor, task, type Task } from './workflow';
import { baselineFingerprint, digest, fileEvidence, fingerprint, git, testInputEvidence, within } from './workspace';

export class Controller {
  readonly journal: Journal;
  constructor(readonly stateDir: string, private readonly publisher = new Publisher({ fingerprint })) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.journal = new Journal(join(stateDir, 'tasks.sqlite'));
  }
  close() { this.journal.close(); }
  read(id: string) { return task.parse(this.journal.read(id).value); }
  brief(id: string) { return brief(this.read(id), this.stateDir); }

  /** Unavailable providers and models across every task, oldest first. */
  outages(): Outage[] {
    const file = join(this.stateDir, 'outages.json');
    try {
      return existsSync(file) ? z.array(outage).parse(JSON.parse(readFileSync(file, 'utf8'))) : [];
    } catch {
      // Only advice for routing: an unreadable record must not stop new tasks.
      return [];
    }
  }

  private recordOutage(target: Model, reason: z.infer<typeof availability>, detail: string) {
    const now = Date.now();
    const kept = this.outages().filter(o => Date.parse(o.until) > now);
    const until = new Date(now + OUTAGE_MS[reason]).toISOString();
    // Written aside and renamed into place, so a reader never sees half a file.
    const file = join(this.stateDir, 'outages.json');
    writeFileSync(`${file}.${process.pid}`, JSON.stringify([...kept,
      { provider: target.provider, model: target.model, reason, until, detail: detail.slice(0, 500) }], null, 2), { mode: 0o600 });
    renameSync(`${file}.${process.pid}`, file);
  }

  create(root: string, input: unknown) {
    root = realpathSync(git(realpathSync(root), ['rev-parse', '--show-toplevel']));
    if (!relative(root, resolve(this.stateDir)).startsWith('..'))
      throw new Error('Task state must live outside the source workspace');
    const spec = contract.parse(input);
    if ('kind' in spec.models && !spec.historyPolicy) throw new Error('New routed tasks require a pre-edit history policy');
    if ('kind' in spec.models && !spec.verificationPolicy) throw new Error('New routed tasks require a requirement verification policy');
    validateVerification(spec);
    if (spec.historyPolicy && (new Set(spec.historyPolicy.paths).size !== spec.historyPolicy.paths.length ||
      spec.historyPolicy.paths.some(p => !spec.scope.some(s => p === s || p.startsWith(`${s.replace(/\/$/, '')}/`)))))
      throw new Error('Planned history paths must be unique and within sealed scope');
    if (git(root, ['status', '--porcelain'])) throw new Error('Start from a clean checkout or a dedicated worktree');
    if (spec.publish.kind === 'pull-request' && spec.publish.baseHead !== git(root, ['rev-parse', 'HEAD']))
      throw new Error('Start the task at its sealed PR base so the entire published diff is reviewed');
    if (Date.parse(spec.limits.deadline) <= Date.now()) throw new Error('Task deadline already elapsed');
    const context = contextPaths(root, spec).map(path => fileEvidence(root, path));
    const references = spec.references.map(ref => prepareReference('/tmp/sovran-harness/references', ref));
    const id = randomUUID();
    const value: Task = {
      version: 1, id, root, base: git(root, ['rev-parse', 'HEAD']), contract: spec,
      phase: 'researching', generation: 0, source: fingerprint(root),
      policy: digest(JSON.stringify({ spec, context, references: references.map(r => r.sha256) })), context, referenceEvidence: null, ticket: null,
      receipts: [], history: [], assessments: [], attempts: [], pending: { kind: 'none' }, publication: null, reason: '', pr: null,
    };
    const policy = inspectChange(root, value.base, spec);
    if (policy.problems.length) throw new Error(policy.problems.join('\n'));
    this.save(value, 'intake-context.json', context.map(item => ({ ...item, content: readFileSync(within(root, item.path), 'utf8') })));
    value.referenceEvidence = this.save(value, 'references.json', references);
    if (spec.historyPolicy) {
      value.historyEvidence = this.save(value, 'baseline-history.json', captureHistory(root, value.base, spec.historyPolicy.paths));
      value.policy = digest(JSON.stringify({ spec, context, references: references.map(r => r.sha256), history: value.historyEvidence.sha256 }));
    }
    this.journal.create(id, value);
    return this.read(id);
  }

  private change(id: string, key: string, input: unknown, fn: (t: Task) => Task, equivalentInputs: unknown[] = []) {
    return task.parse(this.journal.change(id, key, input, value => fn(task.parse(value)), equivalentInputs).value);
  }

  private live(t: Task) {
    if (Date.parse(t.contract.limits.deadline) <= Date.now()) throw new Error('Task budget exhausted; finish incomplete');
    if (['ready', 'incomplete', 'cancelled'].includes(t.phase)) throw new Error(`Task is ${t.phase}`);
  }

  private current(t: Task) {
    this.live(t);
    if (fingerprint(t.root) !== t.source) throw new Error('Candidate changed; repair and verify the new source');
  }

  private issue(t: Task, startIndex = 0): Task {
    const role = roleFor(t.phase);
    if (!role || t.ticket) return t;
    const route = candidates(t.contract.models, role);
    const candidateIndex = route.findIndex((target, i) => i >= startIndex && (role !== 'diversityReview' || this.eligibleDiversity(t, target)));
    const target = route[candidateIndex];
    if (!target) return { ...move(t, 'STOP'), reason: `No eligible authorized model remains for ${role}` };
    const suffix = 'kind' in t.contract.models ? `:${t.attempts.length}` : '';
    return { ...t, ticket: { id: `${t.id}:${t.generation}:${role}${suffix}`, role, target, claim: null,
      candidateIndex, sourceAtIssue: t.source, dispatch: null, runtime: null } };
  }

  next(id: string) {
    const t = this.read(id);
    if (Date.parse(t.contract.limits.deadline) <= Date.now() && !['ready', 'incomplete', 'cancelled'].includes(t.phase))
      return this.stop(id, 'deadline', 'Task deadline exhausted');
    return this.change(id, `issue:${t.generation}:${t.phase}:${t.attempts.length}`, {}, value => this.issue(value));
  }

  beginDispatch(id: string, ticketId: string, coordinator: string, session: string) {
    const input = { ticketId, coordinator, session };
    const result = this.journal.change(id, `dispatch:${ticketId}`, input, value => {
      const t = task.parse(value); this.current(t);
      if (t.ticket?.id !== ticketId || t.ticket.claim || t.ticket.dispatch) throw new Error('Ticket unavailable for dispatch');
      if (t.pending.kind !== 'none') throw new Error('Wait for the outstanding command before dispatch');
      return { ...t, ticket: { ...t.ticket, dispatch: { coordinator, session, requestId: `sovran:${ticketId}` } } };
    });
    return { task: task.parse(result.value), dispatchAuthorized: result.applied };
  }

  claim(id: string, ticketId: string, worker: string, provider: string, model: string, runtime?: RuntimeTask) {
    const observed = runtime ? runtimeTask.parse(runtime) : null;
    const input = { ticketId, worker, provider, model, ...(observed ? { runtime: observed } : {}) };
    return this.change(id, `claim:${ticketId}:${worker}`, input, t => {
      this.live(t);
      if (t.ticket?.id !== ticketId) throw new Error('Stale dispatch ticket');
      if (t.ticket.target.provider !== provider || t.ticket.target.model !== model) throw new Error('Wrong provider/model');
      if (t.ticket.claim && t.ticket.claim.worker !== worker) throw new Error('Ticket already claimed; reconcile the original worker');
      if (t.assessments.some(a => a.worker === worker && a.role !== t.ticket?.role)) throw new Error('Independent roles need separate workers');
      if ('kind' in t.contract.models) {
        if (!t.ticket.dispatch) throw new Error('Reserve dispatch before claiming a routed attempt');
        if (!observed || observed.taskId !== worker || observed.providerInstanceId !== provider || observed.model !== model)
          throw new Error('Claim requires matching T3 runtime identity');
        if (t.attempts.some(a => a.ticket.claim?.worker === worker)) throw new Error('Every attempt needs a fresh worker');
      }
      return { ...t, ticket: { ...t.ticket, claim: { worker, provider, model }, runtime: observed } };
    }, observed ? [] : [{ ...input, runtime: null }]);
  }

  /** Submission means the worker and its processes have finished. A lost worker is
   * never replaced on a timer: the operator/coordinator must reconcile first. */
  submit(id: string, ticketId: string, worker: string, input: unknown, runtime?: RuntimeTask) {
    const result = assessment.parse(input);
    const observed = runtime ? runtimeTask.parse(runtime) : null;
    return this.change(id, `submit:${ticketId}`, { worker, result, ...(observed ? { runtime: observed } : {}) }, t => {
      this.live(t);
      if (t.ticket?.id !== ticketId || t.ticket.claim?.worker !== worker) throw new Error('Unclaimed or stale ticket');
      if (t.pending.kind !== 'none') throw new Error('Wait for the outstanding command before submitting');
      if ('kind' in t.contract.models) {
        this.terminalWorker(t, observed);
        if (observed?.status !== 'completed') throw new Error('Only completed worker output can be submitted');
      }
      const role = t.ticket.role;
      if (role !== 'implementation' && result.verdict !== 'inconclusive') this.current(t);
      if (role === 'audit' && !t.contract.auditChecks.every(c => t.receipts.some(r => r.id === c.id && r.source === t.source && r.outcome === 'pass')))
        throw new Error('Run every audit retrieval/check before submitting judgment');
      const source = fingerprint(t.root);
      if (role === 'implementation' && result.verdict === 'pass') {
        const policy = inspectChange(t.root, t.base, t.contract);
        if (policy.problems.length) throw new Error(policy.problems.join('\n'));
      }
      const missing = t.contract.requirements.filter(r => !result.observations.some(o => o.requirement === r.id));
      if (missing.length) throw new Error(`Missing requirement observations: ${missing.map(r => r.id).join(', ')}`);
      if (result.verdict === 'pass' && result.findings.some(f => f.severity === 'blocking'))
        throw new Error('A blocking finding cannot pass');
      const oracleRequirements = new Set<string>();
      for (const review of result.oracleReviews ?? []) {
        if (oracleRequirements.has(review.requirement) || !t.contract.verificationPolicy?.requirements.some(r => (r.kind === 'node' || r.kind === 'native') && r.requirement === review.requirement))
          throw new Error('Oracle reviews must identify unique sealed test requirements');
        oracleRequirements.add(review.requirement);
        if (result.verdict === 'pass' && review.verdict !== 'valid') throw new Error('A negative or unproven test-oracle judgment cannot pass');
      }
      if (['review', 'adversary', 'audit', 'diversityReview'].includes(role) && result.verdict === 'pass') {
        for (const item of assessmentArtifacts(t, role)) {
          if (fileEvidence(join(this.stateDir, t.id), item.path).sha256 !== item.sha256) throw new Error('Evidence changed after execution');
          if (!inspected(result, item))
            throw new Error(`Missing artifact inspection: ${item.path}`);
        }
      }
      if (new Set(result.findings.map(f => f.id)).size !== result.findings.length) throw new Error('Duplicate finding IDs');
      const changed = t.contract.historyPolicy && result.verdict === 'pass'
        ? inspectChange(t.root, t.base, t.contract).changed : [];
      validateHistory(t, role, result, changed, reference => this.inspectReference(t, reference));
      validateResolutions(t, role, worker, result, reference => this.inspectReference(t, reference));
      if (t.contract.verificationPolicy && ['review', 'audit', 'diversityReview'].includes(role) && result.verdict === 'pass') {
        for (const rule of t.contract.verificationPolicy.requirements.filter(r => r.kind === 'node')) {
          const reviews = result.oracleReviews?.filter(r => r.requirement === rule.requirement) ?? [];
          if (reviews.length !== 1 || reviews[0]?.verdict !== 'valid') throw new Error(`Independent test-oracle judgment is missing or negative: ${rule.requirement}`);
          const review = reviews[0];
          const checks = [rule.check, ...(rule.regression ? [`harness:baseline:${rule.check}`] : [])];
          if (rule.cases.some(c => !review.evidence.includes(c.file)) || checks.some(id => {
            const receipt = t.receipts.find(r => r.id === id && r.source === t.source && r.outcome === 'pass');
            return !receipt?.artifacts.some(a => a.path.endsWith('-node-inspection.json') && review.evidence.includes(`artifact:${a.path}`));
          })) throw new Error('Oracle review must cite test source and current candidate/baseline case results');
        }
        for (const rule of t.contract.verificationPolicy.requirements.filter(r => r.kind === 'native')) {
          const reviews = result.oracleReviews?.filter(r => r.requirement === rule.requirement) ?? [];
          if (reviews.length !== 1 || reviews[0]?.verdict !== 'valid') throw new Error(`Independent story-oracle judgment is missing or negative: ${rule.requirement}`);
          const receipt = t.receipts.find(r => r.id === rule.check && r.source === t.source && r.outcome === 'pass');
          if (rule.stories.some(story => !reviews[0]?.evidence.includes(story)) ||
            !receipt?.artifacts.some(a => a.path.endsWith('-native-inspection.json') && reviews[0]?.evidence.includes(`artifact:${a.path}`)))
            throw new Error('Story-oracle review must cite each sealed story and the current native inspection');
        }
      }
      for (const review of result.oracleReviews ?? []) for (const ref of review.evidence) this.inspectReference(t, ref);
      for (const observation of result.observations) this.inspectReference(t, observation.evidence);
      for (const finding of result.findings) this.inspectReference(t, finding.evidence);
      const evidence = this.save(t, `${ticketId.replaceAll(':', '-')}.json`, result);
      const next: Task = { ...t, ticket: null, source, assessments: [...t.assessments, { role, source, worker, result, artifact: evidence, generation: t.generation }],
        attempts: [...t.attempts, { ticket: t.ticket, generation: t.generation, sourceAfter: source,
          completion: { kind: 'submitted', verdict: result.verdict, runtime: observed } }] };
      if (result.verdict === 'inconclusive') return { ...move(next, 'STOP'), reason: result.summary };
      if (result.verdict === 'fail') {
        if (role === 'research' || role === 'implementation') return { ...move(next, 'STOP'), reason: result.summary };
        return this.repairTask(next, result.summary);
      }
      if (role === 'audit' && 'kind' in t.contract.models && !this.hasIndependentCoverage(next)) {
        if (!t.contract.models.allowGptOnly && !t.contract.models.allowClaudeOnly) return { ...move(next, 'STOP'), reason: 'Normal reviews lack complete author-provider coverage or a non-GPT review; additional single-provider review was not authorized' };
        return move(next, 'DIVERSITY');
      }
      return move(next, 'ACCEPT');
    }, observed ? [] : [{ worker, result, runtime: null }]);
  }

  private terminalWorker(t: Task, runtime: RuntimeTask | null) {
    if (!runtime || !t.ticket?.claim || runtime.taskId !== t.ticket.claim.worker ||
        runtime.providerInstanceId !== t.ticket.target.provider || runtime.model !== t.ticket.target.model ||
        !['completed', 'failed', 'cancelled', 'interrupted'].includes(runtime.status) ||
        runtime.workState !== 'result_available' || runtime.hasPendingChildRuns || runtime.hasPendingQuestion)
      throw new Error('Reconcile the exact worker and every child before releasing ownership');
  }

  private eligibleDiversity(t: Task, target: Model) {
    const policy = t.contract.models;
    if (!('kind' in policy)) return false;
    const family = driver(policy, target);
    const approved = family === 'codex' ? policy.allowGptOnly : family === 'claudeAgent' && policy.allowClaudeOnly === true;
    return approved && !t.attempts.some(a => a.ticket.role === 'implementation' &&
      a.ticket.claim && a.ticket.target.model === target.model);
  }

  private currentReviews(t: Task) {
    return t.attempts.filter(a => a.generation === t.generation && a.sourceAfter === t.source &&
      a.completion.kind === 'submitted' && a.completion.verdict === 'pass' &&
      ['review', 'adversary', 'audit', 'diversityReview'].includes(a.ticket.role));
  }

  private hasIndependentCoverage(t: Task) {
    const reviews = this.currentReviews(t).filter(a => a.ticket.role !== 'diversityReview');
    const authors = t.attempts.filter(a => a.ticket.role === 'implementation' && a.ticket.claim);
    return reviews.some(a => driver(t.contract.models, a.ticket.target) === 'claudeAgent') &&
      authors.every(author => reviews.some(reviewer =>
        driver(t.contract.models, reviewer.ticket.target) !== driver(t.contract.models, author.ticket.target)));
  }

  fallback(id: string, ticketId: string, reason: z.infer<typeof availability>, runtime: RuntimeTask, detail: string) {
    const observed = runtimeTask.parse(runtime);
    const cause = availability.parse(reason);
    if (!detail.trim()) throw new Error('Availability evidence is required');
    let target: Model | undefined;
    const result = this.change(id, `fallback:${ticketId}`, { cause, observed, detail }, t => {
      if (t.ticket?.id !== ticketId || !('kind' in t.contract.models)) throw new Error('No routed attempt owns this fallback');
      if (t.pending.kind !== 'none') throw new Error('Outstanding command must finish first');
      this.terminalWorker(t, observed);
      if (observed.status !== 'failed') throw new Error('Only a failed availability attempt can fall back');
      target = t.ticket.target;
      return this.replaceAttempt(t, { kind: 'unavailable', reason: cause, runtime: observed, detail });
    });
    if (target) this.recordOutage(target, cause, detail);
    return result;
  }

  dispatchRejected(id: string, ticketId: string, reason: z.infer<typeof availability>, input: unknown) {
    const rejection = dispatchRejection.parse(input);
    const cause = availability.parse(reason);
    return this.change(id, `dispatch-rejected:${ticketId}`, { cause, rejection }, t => {
      if (!('kind' in t.contract.models) || t.ticket?.id !== ticketId || t.ticket.claim ||
          t.ticket.dispatch?.requestId !== rejection.requestId || t.pending.kind !== 'none')
        throw new Error('Only the exact unclaimed dispatch can be reconciled as not created');
      // This is a trusted coordinator attestation from a definitive provider error.
      // A timeout or an empty lineage search can never establish non-creation.
      return this.replaceAttempt(t, { kind: 'dispatch-rejected', reason: cause, rejection });
    });
  }

  private replaceAttempt(t: Task, completion: Task['attempts'][number]['completion']): Task {
    const previous = t.ticket;
    if (!previous) throw new Error('Missing replacement attempt');
    const source = fingerprint(t.root);
    const next: Task = { ...t, ticket: null, source,
      attempts: [...t.attempts, { ticket: previous, generation: t.generation, sourceAfter: source, completion }] };
    if (['incomplete', 'cancelled'].includes(t.phase)) return next;
    if (Date.parse(t.contract.limits.deadline) <= Date.now()) return { ...move(next, 'STOP'), reason: 'Task deadline exhausted during reconciliation' };
    if ((previous.role !== 'implementation' || !previous.claim) && source !== t.source)
      return { ...move(next, 'STOP'), reason: 'Source changed outside a claimed implementation; availability fallback refused' };
    return this.issue(next, previous.candidateIndex + 1);
  }

  private inspectReference(t: Task, reference: string) {
    if (reference.startsWith('git:')) return inspectHistoricalReference(t, reference);
    // References are whole files. Line/frame observations are kept separately in the assessment.
    if (reference.startsWith('artifact:')) {
      const path = reference.slice('artifact:'.length);
      const registered = [
        ...t.receipts.flatMap(r => r.artifacts), ...t.history.flatMap(r => r.artifacts), ...(t.ciObservations ?? []),
        ...t.assessments.map(a => a.artifact), ...([t.referenceEvidence, t.historyEvidence].filter((a): a is NonNullable<typeof a> => !!a)),
      ].find(item => item.path === path);
      if (!registered) throw new Error(`Unregistered evidence artifact: ${path}`);
      if (fileEvidence(join(this.stateDir, t.id), path).sha256 !== registered.sha256)
        throw new Error(`Evidence changed: ${path}`);
    } else {
      if (isAbsolute(reference)) throw new Error('Evidence must use a repository-relative file path');
      fileEvidence(t.root, reference);
    }
  }

  seal(id: string, policyHash: string) {
    return this.change(id, 'seal', { policyHash }, t => {
      this.current(t);
      if (policyHash !== t.policy) throw new Error('Intake changed; seal the exact reviewed policy');
      return move(t, 'SEAL');
    });
  }

  repair(id: string, reason: string) {
    const t = this.read(id);
    return this.change(id, `repair:${t.generation}:${t.phase}`, { reason }, v => this.repairTask(v, reason));
  }

  private repairTask(t: Task, reason: string): Task {
    this.live(t);
    if (t.ticket || t.pending.kind !== 'none') throw new Error('Outstanding work must be reconciled before repair');
    if (t.generation >= t.contract.limits.repairRounds) return { ...move(t, 'STOP'), reason: `Repair budget exhausted: ${reason}` };
    return { ...move(t, 'REPAIR'), generation: t.generation + 1, source: fingerprint(t.root),
      history: [...t.history, ...t.receipts], receipts: [], reason };
  }

  stop(id: string, key: string, reason: string, cancel = false) {
    if (!reason.trim()) throw new Error('A stopping reason is required');
    return this.change(id, `stop:${key}`, { reason, cancel }, t => ({ ...move(t, cancel ? 'CANCEL' : 'STOP'), reason }));
  }

  workerStopped(id: string, ticket: string, worker: string, reason: string) {
    // Trusted T3 coordinator attests terminal status and no live child runs.
    // This releases ownership, never accepts unfinished work as evidence.
    return this.change(id, `worker-stopped:${ticket}`, { worker, reason }, t => {
      if (t.ticket?.id !== ticket || t.ticket.claim?.worker !== worker) throw new Error('Worker does not own this ticket');
      const next: Task = { ...t, ticket: null, reason, attempts: [...t.attempts, {
        ticket: t.ticket, generation: t.generation, sourceAfter: fingerprint(t.root), completion: { kind: 'stopped', reason },
      }] };
      return ['incomplete', 'cancelled'].includes(t.phase) ? next : move(next, 'STOP');
    });
  }

  withdrawTicket(id: string, ticket: string, reason: string) {
    // Trusted coordinator attests no dispatch occurred, or every identified child
    // is terminal. Never use this for an ambiguous/lost dispatch response.
    return this.change(id, `withdraw:${ticket}`, { reason }, t => {
      if (t.ticket?.id !== ticket || t.ticket.claim) throw new Error('Only an unclaimed, undispatched ticket can be withdrawn');
      const next: Task = { ...t, ticket: null, reason, attempts: [...t.attempts, {
        ticket: t.ticket, generation: t.generation, sourceAfter: fingerprint(t.root), completion: { kind: 'stopped', reason },
      }] };
      return ['incomplete', 'cancelled'].includes(t.phase) ? next : move(next, 'STOP');
    });
  }

  reconcileCommand(id: string) {
    const before = this.read(id);
    if (before.pending.kind !== 'command' || !before.pending.pid) throw new Error('No recorded process group; outcome requires host investigation');
    try { process.kill(-before.pending.pid, 0); throw new Error('Command process group is still alive; retain ownership'); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
    return this.change(id, `reconcile:${before.generation}:${before.pending.id}`, {}, t => {
      if (t.generation !== before.generation || JSON.stringify(t.pending) !== JSON.stringify(before.pending)) throw new Error('Stale process reconciliation');
      if (t.ticket) throw new Error('A worker still owns this task');
      const next: Task = { ...t, pending: { kind: 'none' }, reason: 'Interrupted check process group is gone; available logs retained, outcome unproven' };
      return ['incomplete', 'cancelled'].includes(t.phase) ? next : move(next, 'STOP');
    });
  }

  publish(id: string) {
    let t = this.read(id);
    this.current(t);
    if (t.phase === 'publishing') {
      if (!t.publication) throw new Error('Missing publication intent');
      const result = this.publisher.publish(t.publication, false);
      if (result.status === 'unknown') return { ...t, reason: result.reason };
      return this.published(t, { url: result.pr.url, head: result.pr.headRefOid, number: result.pr.number });
    }
    if (t.phase !== 'publishable') throw new Error('All local gates must pass before publication');
    for (const a of t.assessments) this.inspectReference(t, `artifact:${a.artifact.path}`);
    if (unresolved(t).length) throw new Error('Unresolved obligations prevent publication');
    if ('kind' in t.contract.models) {
      const reviews = this.currentReviews(t);
      if (!['review', 'adversary', 'audit'].every(role => reviews.some(a => a.ticket.role === role)))
        throw new Error('Missing current independent review slots');
      if (!this.hasIndependentCoverage(t) && !reviews.some(a =>
        a.ticket.role === 'diversityReview' && this.eligibleDiversity(t, a.ticket.target)))
        throw new Error('Missing additional approved single-provider review by a model outside the complete author set');
    }
    if (t.contract.publish.kind !== 'pull-request') throw new Error('Publication was not authorized at intake');
    const policy = inspectChange(t.root, t.base, t.contract);
    if (policy.problems.length) throw new Error(policy.problems.join('\n'));
    const plan = publishPlan.parse({ ...t.contract.publish, taskId: t.id, root: t.root,
      previousRemoteHead: t.pr?.head ?? t.contract.publish.previousRemoteHead,
      source: t.source, head: git(t.root, ['rev-parse', 'HEAD']), title: t.contract.problem.slice(0, 160),
      body: `${t.contract.problem}\n\n${t.contract.requirements.map(r => `- ${r.outcome}`).join('\n')}\n\nValidation: ${t.receipts.map(r => `${r.id}: ${r.outcome}`).join('; ')}. Independent review, adversarial review and final audit completed for this source.${'kind' in t.contract.models ? `\n\nModel attempts: ${t.attempts.map(a => `${a.ticket.role}: ${a.ticket.target.provider}/${a.ticket.target.model} (${a.completion.kind})`).join('; ')}. Requested effort is recorded; T3 did not report effective effort.${!this.hasIndependentCoverage(t) ? ` Additional ${this.currentReviews(t).some(a => a.ticket.role === 'diversityReview' && driver(t.contract.models, a.ticket.target) === 'claudeAgent') ? 'Claude' : 'GPT'} review used outside the author set because normal reviews lacked full provider coverage or a non-GPT reviewer.` : ''}` : ''}`,
    });
    const claim = this.journal.change(id, `publish:${t.generation}`, { plan }, value => {
      const v = task.parse(value); this.current(v);
      if (v.pending.kind !== 'none' || v.ticket) throw new Error('Outstanding work');
      return { ...move(v, 'PUBLISH'), publication: plan, pending: { kind: 'publish', head: plan.head } };
    });
    if (!claim.applied) return this.read(id);
    t = task.parse(claim.value);
    const result = this.publisher.publish(plan, true);
    if (result.status === 'unknown') return { ...t, reason: result.reason };
    return this.published(t, { url: result.pr.url, head: result.pr.headRefOid, number: result.pr.number });
  }

  private published(before: Task, pr: NonNullable<Task['pr']>) {
    return this.change(before.id, `published:${before.generation}`, { pr }, t => {
      if (t.generation !== before.generation || t.pending.kind !== 'publish' || t.pending.head !== pr.head ||
        t.publication?.head !== before.publication?.head) throw new Error('Stale publication result');
      const next: Task = { ...t, pending: { kind: 'none' }, pr };
      if (['incomplete', 'cancelled'].includes(t.phase)) return next;
      if (t.phase !== 'publishing') throw new Error('Publication phase changed');
      return move(next, 'ACCEPT');
    });
  }

  checkCI(id: string) {
    const t = this.read(id); this.current(t);
    if (t.phase !== 'ci' || !t.publication || !t.pr) throw new Error('No published task waiting for CI');
    if (unresolved(t).length) throw new Error('Unresolved obligations prevent readiness');
    const result = this.publisher.check(t.publication, t.pr.number);
    return this.change(id, `ci:${t.generation}:${digest(JSON.stringify(result))}`, result, v => {
      this.current(v);
      if (v.generation !== t.generation || v.phase !== 'ci' || v.source !== t.source ||
        v.publication?.head !== t.publication?.head || v.pr?.head !== t.pr?.head || v.pr?.number !== t.pr?.number)
        throw new Error('Stale CI result; keep the current task generation');
      const artifact = this.save(v, `ci-${digest(JSON.stringify(result))}.json`, result);
      const observed: Task = { ...v, ciObservations: [...(v.ciObservations ?? []), artifact] };
      if (result.status === 'waiting') return { ...observed, reason: result.reason };
      const next: Task = { ...observed, receipts: [...v.receipts, { id: 'harness:ci', source: z.string().parse(v.source),
        artifacts: [artifact], outcome: result.status === 'ready' ? 'pass' : 'fail', summary: result.reason }] };
      return result.status === 'failed' ? this.repairTask(next, result.reason) : { ...move(next, 'ACCEPT'), reason: result.reason };
    });
  }

  save(t: Task, name: string, value: unknown) {
    const dir = join(this.stateDir, t.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = `${t.generation}-${name}`;
    const data = JSON.stringify(value, null, 2);
    if (existsSync(join(dir, path))) {
      if (readFileSync(join(dir, path), 'utf8') !== data) throw new Error('Immutable artifact already exists with different content');
    } else writeFileSync(join(dir, path), data, { flag: 'wx', mode: 0o600 });
    return { path, sha256: digest(data) };
  }

  async verify(id: string, audit = false) {
    let t = this.read(id);
    this.current(t);
    if (t.phase !== (audit ? 'auditing' : 'verifying')) throw new Error('Wrong verification phase');
    if (t.pending.kind !== 'none') throw new Error('Previous command outcome unknown; reconcile before retrying');
    const directory = join(this.stateDir, t.id);
    const upgradePath = join(directory, `${t.generation}-upgrade.json`);
    const needsUpgrade = inspectChange(t.root, t.base, t.contract).risks.includes('persistence');
    const selectedCommands = audit ? t.contract.auditChecks : [...t.contract.checks, ...(needsUpgrade ? [
      { id: 'harness:upgrade-inventory', argv: ['bun', join(import.meta.dir, 'discover-upgrade.ts'), t.root], cwd: '.', timeoutMs: 60_000 },
      { id: 'harness:upgrade', argv: ['bun', 'run', 'test:upgrade', '--json', `--outputFile=${upgradePath}`], cwd: 'app', timeoutMs: 600_000 },
    ] : [])];
    const commands = selectedCommands.flatMap(check => isNodeCheck(check) && check.regression
      ? [{ ...check, id: `harness:baseline:${check.id}`, baseline: check.regression }, check] : [check]);
    for (const check of commands) {
      if (t.receipts.some(r => r.id === check.id && r.source === t.source && r.outcome === 'pass')) continue;
      // Deterministic launch errors must not reserve an effect that never started.
      const baseline = 'baseline' in check ? regression.parse(check.baseline) : null;
      const executionRoot = baseline ? join(directory, `${t.generation}-${digest(check.id)}-baseline`) : t.root;
      const cwd = baseline ? executionRoot : within(t.root, check.cwd);
      const node = isNodeCheck(check) ? check : null;
      const native = isNativeCheck(check) ? check : null;
      const nativeOut = `${t.generation}-${digest(check.id)}-native`;
      const invocation = digest(JSON.stringify([t.id, t.generation, check.id, t.source]));
      const collector = join(import.meta.dir, 'node-tests.mjs');
      const nodeExecutable = node ? Bun.which('node') : null;
      if (node && !nodeExecutable) throw new Error('Node test runtime is unavailable');
      if ('argv' in check && !Bun.which(z.string().parse(check.argv[0]), { cwd })) throw new Error('Check executable not found');
      const inputPaths = node ? [...new Set([...node.files, ...(node.regression?.testInputs ?? [])])] : [];
      const inputs = testInputEvidence(t.root, inputPaths);
      const inputsMatch = (root: string) => inputs.every(input =>
        fileEvidence(root, input.path).sha256 === input.sha256 &&
        Boolean(lstatSync(within(root, input.path)).mode & 0o111) === input.executable);
      const dir = join(this.stateDir, t.id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const claimed = this.journal.change(id, `execute:${t.generation}:${check.id}`, {}, value => {
        const v = task.parse(value);
        this.current(v);
        if (v.pending.kind !== 'none') throw new Error('Another command owns this task');
        return { ...v, pending: { kind: 'command', id: check.id } };
      });
      if (!claimed.applied) throw new Error('Command was already dispatched; reconcile its outcome');
      t = task.parse(claimed.value);
      const log = `${t.generation}-${digest(check.id)}.log`;
      let ownedBaseline = false;
      let preparedSource: string | null = null;
      let setupFailure: string | null = null;
      let request: { path: string; sha256: string } | null = null;
      let argv: string[] = 'argv' in check ? check.argv : [];
      try {
        if (baseline) {
          if (existsSync(executionRoot)) throw new Error('Baseline workspace already exists; reconcile its previous ownership');
          git(t.root, ['worktree', 'add', '--quiet', '--detach', '--', executionRoot, t.base]);
          ownedBaseline = true;
          for (const file of baseline.testInputs) {
            let dest = executionRoot;
            for (const part of file.split('/')) {
              dest = join(dest, part);
              try { if (lstatSync(dest).isSymbolicLink()) throw new Error('Baseline test input traverses a symlink'); }
              catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
            }
            mkdirSync(dirname(dest), { recursive: true });
            const source = within(t.root, file);
            writeFileSync(dest, readFileSync(source));
            chmodSync(dest, lstatSync(source).mode & 0o777);
          }
          preparedSource = baselineFingerprint(executionRoot);
        }
        if (node) {
          if (!inputsMatch(executionRoot)) throw new Error('Test input changed during baseline preparation');
          request = this.save(t, `${digest(check.id)}-node-request.json`, {
            invocation, root: executionRoot, source: t.source, nodeExecutable, collector: digest(readFileSync(collector)),
            files: node.files.map(file => within(executionRoot, file)), selection: node.requiredCases,
            inputs,
            ...(baseline ? { baseline: t.base, preparedSource, copiedInputs: baseline.testInputs.map(file => fileEvidence(executionRoot, file)), expectedFailures: baseline.cases } : {}),
          });
          argv = [z.string().parse(nodeExecutable), collector, join(directory, request.path)];
        }
        if (native) {
          // The runner is candidate code; a candidate that edits it could grade itself.
          const runner = nativeRunnerChanges(inspectChange(t.root, t.base, t.contract).changed);
          if (runner.length) throw new Error(`Candidate changes the native story runner: ${runner.join(', ')}`);
          if (existsSync(join(directory, nativeOut))) throw new Error('Native evidence already exists; reconcile its previous run');
          request = this.save(t, `${digest(check.id)}-native-request.json`, {
            invocation, out: join(directory, nativeOut), stories: native.stories, platforms: native.platforms });
          argv = ['bun', 'app/e2e/stories/bound.ts', join(directory, request.path)];
        }
      } catch (error) { setupFailure = String(error); }
      const { exit, reason } = setupFailure ? (() => {
        writeFileSync(join(dir, log), '', { flag: 'wx', mode: 0o600 });
        writeFileSync(join(dir, `${log}.stderr`), setupFailure, { flag: 'wx', mode: 0o600 });
        return { exit: 1, reason: `Check setup failed: ${setupFailure}` };
      })() : await runCommand(argv, cwd, join(dir, log), join(dir, `${log}.stderr`),
        Math.max(1, Math.min(check.timeoutMs, Date.parse(t.contract.limits.deadline) - Date.now())), pid => {
          this.change(id, `started:${t.generation}:${check.id}`, { pid }, v => {
            if (v.pending.kind !== 'command' || v.pending.id !== check.id) throw new Error('Command ownership lost');
            return { ...v, pending: { ...v.pending, pid } };
          });
        }, node ? { ...process.env, NODE_OPTIONS: undefined, NODE_TEST_CONTEXT: undefined } : process.env);
      const logArtifact = { path: log, sha256: digest(readFileSync(join(dir, log))) };
      const stderrArtifact = { path: `${log}.stderr`, sha256: digest(readFileSync(join(dir, `${log}.stderr`))) };
      const artifacts = [logArtifact, stderrArtifact, ...(request ? [request] : [])];
      let outcome: 'pass' | 'fail' | 'inconclusive' = exit === 0 ? 'pass' : 'fail';
      let summary = `${reason}: ${argv.join(' ')}`;
      if (node) {
        try {
          const inspected = inspectNodeTests(readFileSync(join(dir, log), 'utf8'), { invocation, root: executionRoot, files: node.files, requiredCases: node.requiredCases, expectedFailures: baseline?.cases });
          artifacts.push(this.save(t, `${digest(check.id)}-node-inspection.json`, inspected));
          if (exit === 0) outcome = inspected.outcome;
          summary = inspected.problems.length ? inspected.problems.join('\n') : `${baseline ? 'Baseline assertions established; ' : ''}Executed ${inspected.cases.length} named cases with ${inspected.node}; ${reason}`;
        } catch (error) { outcome = 'fail'; summary = `Required test execution was not established: ${String(error)}`; }
        try {
          if (!inputsMatch(executionRoot) || !inputsMatch(t.root))
            throw new Error('Candidate or baseline test input changed during execution');
        } catch (error) { outcome = 'fail'; summary = String(error); }
      }
      if (native && request) {
        try {
          const inspected = inspectNativeStories(join(dir, nativeOut), { invocation, source: z.string().parse(t.source), root: t.root, stories: native.stories, platforms: native.platforms });
          // Every frame, video and log becomes receipt evidence, which reviewers must inspect.
          artifacts.push(...inspected.files.map(file => fileEvidence(dir, join(nativeOut, file))), this.save(t, `${digest(check.id)}-native-inspection.json`, inspected));
          if (exit === 0) outcome = inspected.outcome;
          summary = inspected.problems.length ? inspected.problems.join('\n') : `Played ${native.stories.length} sealed stories on ${native.platforms.join(' and ')}; ${reason}`;
        } catch (error) { outcome = 'fail'; summary = `Native story evidence was not established: ${String(error)}`; }
      }
      if (ownedBaseline) {
        // A tampered baseline may no longer fingerprint at all; that is a failed check, not a crash.
        let unchanged = !preparedSource;
        try { unchanged ||= baselineFingerprint(executionRoot) === preparedSource; } catch { unchanged = false; }
        if (!unchanged) { outcome = 'fail'; summary = 'Baseline changed during regression execution'; }
        // runCommand has reconciled the process group before a disposable baseline is removed.
        git(t.root, ['worktree', 'remove', '--force', '--', executionRoot]);
      }
      if (check.id === 'harness:upgrade' && exit === 0) {
        try {
          const inventoryPath = join(dir, `${t.generation}-${digest('harness:upgrade-inventory')}.log`);
          const inventory = upgradeInventorySchema.parse(JSON.parse(readFileSync(inventoryPath, 'utf8')));
          if (inventory.sourceFingerprint !== t.source) throw new Error('Upgrade inventory is stale');
          const inspected = inspectUpgradeEvidence(JSON.parse(readFileSync(upgradePath, 'utf8')), inventory);
          artifacts.push(fileEvidence(dir, `${t.generation}-upgrade.json`), this.save(t, 'upgrade-inspection.json', inspected));
          outcome = inspected.status;
          summary = upgradeReceiptSummary(inspected);
        } catch (error) { outcome = 'inconclusive'; summary = `Upgrade evidence unavailable: ${String(error)}`; }
      }
      t = this.change(id, `result:${t.generation}:${check.id}`, { exit, artifacts, outcome, summary }, v => {
        if (v.pending.kind !== 'command' || v.pending.id !== check.id) throw new Error('Command ownership lost');
        const source = z.string().parse(v.source);
        const changed = fingerprint(v.root) !== source;
        const next: Task = { ...v, pending: { kind: 'none' }, receipts: [...v.receipts, { id: check.id, source, artifacts, outcome: changed ? 'inconclusive' : outcome, summary }] };
        if (['incomplete', 'cancelled'].includes(v.phase)) return next;
        if (Date.parse(v.contract.limits.deadline) <= Date.now()) return { ...move(next, 'STOP'), reason: 'Task deadline exhausted during verification' };
        if (changed) return { ...move(next, 'STOP'), reason: 'Candidate changed during verification; logs retained, result is inconclusive' };
        if (outcome === 'inconclusive') return { ...move(next, 'STOP'), reason: summary };
        return next;
      });
      if (['incomplete', 'cancelled'].includes(t.phase)) return t;
      if (outcome === 'fail') return this.repair(id, `Check failed: ${check.id}`);
    }
    if (audit) return t; // Retrieval is evidence; an independent audit ticket supplies judgment.
    const risks = inspectChange(t.root, t.base, t.contract).risks;
    if (risks.includes('performance'))
      return this.stop(id, `native-evidence:${t.generation}`, 'Performance results are not yet bound to sealed metrics on a required device. See docs/follow-ups/F156.md');
    // UI work needs bound story runs on both platforms at this source; the receipt loop above required them to pass.
    if (risks.includes('ui') && !(['ios', 'android'] as const).every(p => t.contract.verificationPolicy?.requirements.some(r =>
      r.kind === 'native' && r.platforms.includes(p))))
      return this.stop(id, `native-evidence:${t.generation}`, 'UI changes need a native requirement whose sealed stories play on both iOS and Android');
    return this.change(id, `verified:${t.generation}`, {}, v => {
      this.current(v);
      if (v.generation !== t.generation || v.phase !== 'verifying') throw new Error('Stale verification result');
      if (!commands.every(c => v.receipts.some(r => r.id === c.id && r.outcome === 'pass' && r.source === v.source))) throw new Error('Missing verification');
      // The repair reason served the repair; the journal keeps it.
      return { ...move(v, 'ACCEPT'), reason: '' };
    });
  }
}
