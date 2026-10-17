import { z } from 'zod';
import { Controller } from './controller';
import { assessment, contract } from './workflow';
import { availability, dispatchRejection, modelCatalog, recommendedModels, runtimeTask } from './models';

const id = z.string().uuid();
const text = z.string().min(1);
export const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('model-policy'), catalog: modelCatalog }),
  z.object({ action: z.literal('create'), root: text, contract }),
  z.object({ action: z.literal('status'), id }),
  z.object({ action: z.literal('next'), id }),
  z.object({ action: z.literal('brief'), id }),
  z.object({ action: z.literal('begin-dispatch'), id, ticket: text, coordinator: text, session: text }),
  z.object({ action: z.literal('fallback'), id, ticket: text, reason: availability, runtime: runtimeTask, detail: text }),
  z.object({ action: z.literal('dispatch-rejected'), id, ticket: text, reason: availability, rejection: dispatchRejection }),
  z.object({ action: z.literal('reconcile-command'), id }),
  z.object({ action: z.literal('publish'), id }),
  z.object({ action: z.literal('check-ci'), id }),
  z.object({ action: z.literal('worker-stopped'), id, ticket: text, worker: text, reason: text }),
  z.object({ action: z.literal('withdraw-ticket'), id, ticket: text, reason: text }),
  z.object({ action: z.literal('seal'), id, policy: text }),
  z.object({ action: z.literal('claim'), id, ticket: text, worker: text, provider: text, model: text, runtime: runtimeTask.optional() }),
  z.object({ action: z.literal('submit'), id, ticket: text, worker: text, assessment, runtime: runtimeTask.optional() }),
  z.object({ action: z.literal('verify'), id, audit: z.boolean().default(false) }),
  z.object({ action: z.literal('repair'), id, reason: text }),
  z.object({ action: z.literal('stop'), id, key: text, reason: text, cancel: z.boolean().default(false) }),
]);

export async function dispatch(controller: Controller, input: unknown) {
  const r = request.parse(input);
  switch (r.action) {
    case 'model-policy': return recommendedModels(r.catalog, controller.outages());
    case 'create': return controller.create(r.root, r.contract);
    case 'status': return controller.read(r.id);
    case 'next': return controller.next(r.id);
    case 'brief': return controller.brief(r.id);
    case 'begin-dispatch': return controller.beginDispatch(r.id, r.ticket, r.coordinator, r.session);
    case 'fallback': return controller.fallback(r.id, r.ticket, r.reason, r.runtime, r.detail);
    case 'dispatch-rejected': return controller.dispatchRejected(r.id, r.ticket, r.reason, r.rejection);
    case 'reconcile-command': return controller.reconcileCommand(r.id);
    case 'publish': return controller.publish(r.id);
    case 'check-ci': return controller.checkCI(r.id);
    case 'worker-stopped': return controller.workerStopped(r.id, r.ticket, r.worker, r.reason);
    case 'withdraw-ticket': return controller.withdrawTicket(r.id, r.ticket, r.reason);
    case 'seal': return controller.seal(r.id, r.policy);
    case 'claim': return controller.claim(r.id, r.ticket, r.worker, r.provider, r.model, r.runtime);
    case 'submit': return controller.submit(r.id, r.ticket, r.worker, r.assessment, r.runtime);
    case 'verify': return controller.verify(r.id, r.audit);
    case 'repair': return controller.repair(r.id, r.reason);
    case 'stop': return controller.stop(r.id, r.key, r.reason, r.cancel);
  }
}
