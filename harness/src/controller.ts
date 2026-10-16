import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { Journal } from './journal';
import { runCommand } from './command';
import { inspectChange } from './policy';
import { inspectUpgradeEvidence, upgradeInventorySchema } from './upgrade';
import { brief } from './brief';
import { Publisher, publishPlan } from './publisher';
import { contextPaths } from './context';
import { prepareReference } from './references';
import { assessment, contract, move, roleFor, task, type Task } from './workflow';
import { digest, fileEvidence, fingerprint, git, within } from './workspace';

export class Controller {
  readonly journal: Journal;
  constructor(readonly stateDir: string, private readonly publisher = new Publisher({ fingerprint })) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.journal = new Journal(join(stateDir, 'tasks.sqlite'));
  }
  close() { this.journal.close(); }
  read(id: string) { return task.parse(this.journal.read(id).value); }
  brief(id: string) { return brief(this.read(id), this.stateDir); }

  create(root: string, input: unknown) {
    root = realpathSync(git(realpathSync(root), ['rev-parse', '--show-toplevel']));
    if (!relative(root, resolve(this.stateDir)).startsWith('..'))
      throw new Error('Task state must live outside the source workspace');
    const spec = contract.parse(input);
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
      receipts: [], history: [], assessments: [], pending: { kind: 'none' }, publication: null, reason: '', pr: null,
    };
    const policy = inspectChange(root, value.base, spec);
    if (policy.problems.length) throw new Error(policy.problems.join('\n'));
    this.save(value, 'intake-context.json', context.map(item => ({ ...item, content: readFileSync(within(root, item.path), 'utf8') })));
    value.referenceEvidence = this.save(value, 'references.json', references);
    this.journal.create(id, value);
    return this.read(id);
  }

  private change(id: string, key: string, input: unknown, fn: (t: Task) => Task) {
    return task.parse(this.journal.change(id, key, input, value => fn(task.parse(value))).value);
  }

  private live(t: Task) {
    if (Date.parse(t.contract.limits.deadline) <= Date.now()) throw new Error('Task budget exhausted; finish incomplete');
    if (['ready', 'incomplete', 'cancelled'].includes(t.phase)) throw new Error(`Task is ${t.phase}`);
  }

  private current(t: Task) {
    this.live(t);
    if (fingerprint(t.root) !== t.source) throw new Error('Candidate changed; repair and verify the new source');
  }

  private issue(t: Task): Task {
    const role = roleFor(t.phase);
    if (!role || t.ticket) return t;
    return { ...t, ticket: { id: `${t.id}:${t.generation}:${role}`, role, target: t.contract.models[role], claim: null } };
  }

  next(id: string) {
    const t = this.read(id);
    if (Date.parse(t.contract.limits.deadline) <= Date.now() && !['ready', 'incomplete', 'cancelled'].includes(t.phase))
      return this.stop(id, 'deadline', 'Task deadline exhausted');
    return this.change(id, `issue:${t.generation}:${t.phase}`, {}, value => this.issue(value));
  }

  claim(id: string, ticketId: string, worker: string, provider: string, model: string) {
    const input = { ticketId, worker, provider, model };
    return this.change(id, `claim:${ticketId}:${worker}`, input, t => {
      this.live(t);
      if (t.ticket?.id !== ticketId) throw new Error('Stale dispatch ticket');
      if (t.ticket.target.provider !== provider || t.ticket.target.model !== model) throw new Error('Wrong provider/model');
      if (t.ticket.claim && t.ticket.claim.worker !== worker) throw new Error('Ticket already claimed; reconcile the original worker');
      if (t.assessments.some(a => a.worker === worker && a.role !== t.ticket?.role)) throw new Error('Independent roles need separate workers');
      return { ...t, ticket: { ...t.ticket, claim: { worker, provider, model } } };
    });
  }

  /** Submission means the worker and its processes have finished. A lost worker is
   * never replaced on a timer: the operator/coordinator must reconcile first. */
  submit(id: string, ticketId: string, worker: string, input: unknown) {
    const result = assessment.parse(input);
    return this.change(id, `submit:${ticketId}`, { worker, result }, t => {
      this.live(t);
      if (t.ticket?.id !== ticketId || t.ticket.claim?.worker !== worker) throw new Error('Unclaimed or stale ticket');
      if (t.pending.kind !== 'none') throw new Error('Wait for the outstanding command before submitting');
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
      if (['review', 'adversary', 'audit'].includes(role) && result.verdict === 'pass') {
        for (const item of t.receipts.flatMap(r => r.artifacts)) {
          if (fileEvidence(join(this.stateDir, t.id), item.path).sha256 !== item.sha256) throw new Error('Evidence changed after execution');
          if (!result.inspections.some(i => i.path === item.path && i.sha256 === item.sha256))
            throw new Error(`Missing artifact inspection: ${item.path}`);
        }
      }
      for (const observation of result.observations) this.inspectReference(t, observation.evidence);
      for (const finding of result.findings) this.inspectReference(t, finding.evidence);
      const evidence = this.save(t, `${ticketId.replaceAll(':', '-')}.json`, result);
      const next: Task = { ...t, ticket: null, source, assessments: [...t.assessments, { role, source, worker, result, artifact: evidence }] };
      if (result.verdict === 'inconclusive') return { ...move(next, 'STOP'), reason: result.summary };
      if (result.verdict === 'fail') {
        if (role === 'research' || role === 'implementation') return { ...move(next, 'STOP'), reason: result.summary };
        return this.repairTask(next, result.summary);
      }
      return move(next, 'ACCEPT');
    });
  }

  private inspectReference(t: Task, reference: string) {
    // References are whole files. Line/frame observations are kept separately in the assessment.
    if (reference.startsWith('artifact:')) {
      const path = reference.slice('artifact:'.length);
      const registered = [
        ...t.receipts.flatMap(r => r.artifacts), ...t.history.flatMap(r => r.artifacts),
        ...t.assessments.map(a => a.artifact), ...(t.referenceEvidence ? [t.referenceEvidence] : []),
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
      const next: Task = { ...t, ticket: null, reason };
      return ['incomplete', 'cancelled'].includes(t.phase) ? next : move(next, 'STOP');
    });
  }

  withdrawTicket(id: string, ticket: string, reason: string) {
    // Trusted coordinator attests no dispatch occurred, or every identified child
    // is terminal. Never use this for an ambiguous/lost dispatch response.
    return this.change(id, `withdraw:${ticket}`, { reason }, t => {
      if (t.ticket?.id !== ticket || t.ticket.claim) throw new Error('Only an unclaimed, undispatched ticket can be withdrawn');
      const next: Task = { ...t, ticket: null, reason };
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
    if (t.contract.publish.kind !== 'pull-request') throw new Error('Publication was not authorized at intake');
    const policy = inspectChange(t.root, t.base, t.contract);
    if (policy.problems.length) throw new Error(policy.problems.join('\n'));
    const plan = publishPlan.parse({ ...t.contract.publish, taskId: t.id, root: t.root,
      previousRemoteHead: t.pr?.head ?? t.contract.publish.previousRemoteHead,
      source: t.source, head: git(t.root, ['rev-parse', 'HEAD']), title: t.contract.problem.slice(0, 160),
      body: `${t.contract.problem}\n\n${t.contract.requirements.map(r => `- ${r.outcome}`).join('\n')}\n\nValidation: ${t.receipts.map(r => `${r.id}: ${r.outcome}`).join('; ')}. Independent review, adversarial review and final audit completed for this source.`,
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
    const result = this.publisher.check(t.publication, t.pr.number);
    return this.change(id, `ci:${t.generation}:${digest(JSON.stringify(result))}`, result, v => {
      this.current(v);
      if (v.generation !== t.generation || v.phase !== 'ci' || v.source !== t.source ||
        v.publication?.head !== t.publication?.head || v.pr?.head !== t.pr?.head || v.pr?.number !== t.pr?.number)
        throw new Error('Stale CI result; keep the current task generation');
      if (result.status === 'waiting') return { ...v, reason: result.reason };
      const artifact = this.save(v, `ci-${digest(JSON.stringify(result))}.json`, result);
      const next: Task = { ...v, receipts: [...v.receipts, { id: 'harness:ci', source: z.string().parse(v.source),
        artifacts: [artifact], outcome: result.status === 'ready' ? 'pass' : 'fail', summary: result.reason }] };
      return result.status === 'failed' ? this.repairTask(next, result.reason) : move(next, 'ACCEPT');
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
    const commands = audit ? t.contract.auditChecks : [...t.contract.checks, ...(needsUpgrade ? [
      { id: 'harness:upgrade-inventory', argv: ['bun', join(import.meta.dir, 'discover-upgrade.ts'), t.root], cwd: '.', timeoutMs: 60_000 },
      { id: 'harness:upgrade', argv: ['bun', 'run', 'test:upgrade', '--json', `--outputFile=${upgradePath}`], cwd: 'app', timeoutMs: 600_000 },
    ] : [])];
    for (const check of commands) {
      if (t.receipts.some(r => r.id === check.id && r.source === t.source && r.outcome === 'pass')) continue;
      // Deterministic launch errors must not reserve an effect that never started.
      const cwd = within(t.root, check.cwd);
      if (!Bun.which(z.string().parse(check.argv[0]), { cwd })) throw new Error('Check executable not found');
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
      const { exit, reason } = await runCommand(check.argv, cwd, join(dir, log), join(dir, `${log}.stderr`),
        Math.max(1, Math.min(check.timeoutMs, Date.parse(t.contract.limits.deadline) - Date.now())), pid => {
          this.change(id, `started:${t.generation}:${check.id}`, { pid }, v => {
            if (v.pending.kind !== 'command' || v.pending.id !== check.id) throw new Error('Command ownership lost');
            return { ...v, pending: { ...v.pending, pid } };
          });
        });
      const logArtifact = { path: log, sha256: digest(readFileSync(join(dir, log))) };
      const stderrArtifact = { path: `${log}.stderr`, sha256: digest(readFileSync(join(dir, `${log}.stderr`))) };
      const artifacts = [logArtifact, stderrArtifact];
      let outcome: 'pass' | 'fail' | 'inconclusive' = exit === 0 ? 'pass' : 'fail';
      let summary = `${reason}: ${check.argv.join(' ')}`;
      if (check.id === 'harness:upgrade' && exit === 0) {
        try {
          const inventoryPath = join(dir, `${t.generation}-${digest('harness:upgrade-inventory')}.log`);
          const inventory = upgradeInventorySchema.parse(JSON.parse(readFileSync(inventoryPath, 'utf8')));
          if (inventory.sourceFingerprint !== t.source) throw new Error('Upgrade inventory is stale');
          const inspected = inspectUpgradeEvidence(JSON.parse(readFileSync(upgradePath, 'utf8')), inventory);
          artifacts.push(fileEvidence(dir, `${t.generation}-upgrade.json`), this.save(t, 'upgrade-inspection.json', inspected));
          outcome = inspected.status;
          summary = inspected.status === 'pass' ? 'Recorded historical fixture checks passed; this is bounded unit evidence' : inspected.reasons.join('\n');
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
    if (inspectChange(t.root, t.base, t.contract).risks.some(risk => risk === 'ui' || risk === 'performance'))
      return this.stop(id, `native-evidence:${t.generation}`, 'Functional native/performance results are not yet bound to an installed binary on both platforms. See docs/follow-ups/F156.md');
    return this.change(id, `verified:${t.generation}`, {}, v => {
      this.current(v);
      if (v.generation !== t.generation || v.phase !== 'verifying') throw new Error('Stale verification result');
      if (!commands.every(c => v.receipts.some(r => r.id === c.id && r.outcome === 'pass' && r.source === v.source))) throw new Error('Missing verification');
      return move(v, 'ACCEPT');
    });
  }
}
