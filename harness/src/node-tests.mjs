// Ordinary stdout becomes an event. Node's binary child protocol is not an authenticity boundary.
import { run, test } from 'node:test';
import { readFileSync } from 'node:fs';
// Older runtimes silently ignore expectFailure, changing what the same test
// means. Reject them before loading candidate code, rather than certifying it.
if (typeof test.expectFailure !== 'function')
  throw new Error(`Unsupported Node test runner ${process.version}: expected-failure metadata is required`);
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const emit = value => process.stdout.write(`${JSON.stringify(value, (_key, value) => value instanceof Error
  ? { name: value.name, message: value.message, code: value.code, failureType: value.failureType, cause: value.cause } : value)}\n`);
emit({ kind: 'start', invocation: request.invocation, node: process.version });
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_TEST_CONTEXT;
for await (const event of run({ files: request.files, cwd: request.root, concurrency: 1, isolation: 'process', execArgv: [], argv: [], env }))
  emit({ kind: 'event', event });
emit({ kind: 'end', invocation: request.invocation });
