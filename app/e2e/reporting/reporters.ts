/**
 * Reporters are pure consumers of the event stream. The bus already redacted
 * every event, so these only format. Three outputs:
 *  - JsonlReporter  — one redacted JSON event per line (machine / CI artifact)
 *  - PlainReporter  — append-only flat text (pipes, non-TTY CI logs)
 *  - TtyReporter    — append-only scrollback + one animated live footer
 * A `Sink` (plain/jsonl) or `Term` (tty) is injected so tests capture output.
 */
import type { Observer, RunnerEvent } from '../core/events';
import { footer, lineFor } from './format';

export interface Sink {
  write(s: string): void;
}
export const arraySink = () => {
  const lines: string[] = [];
  const sink: Sink & { lines: string[] } = { lines, write: (s: string) => void lines.push(s) };
  return sink;
};

export class JsonlReporter {
  constructor(private sink: Sink) {}
  on: Observer = (e) => this.sink.write(JSON.stringify(e) + '\n');
}

export class PlainReporter {
  constructor(
    private sink: Sink,
    private unicode = true
  ) {}
  on: Observer = (e) => {
    const l = lineFor(e, this.unicode);
    if (l !== null) this.sink.write(l + '\n');
  };
}

export interface Term {
  append(line: string): void;
  live(footerLine: string): void;
  end(): void;
}
export const arrayTerm = () => {
  const t = {
    appends: [] as string[],
    lastLive: '',
    ended: false,
    append(l: string) {
      t.appends.push(l);
    },
    live(l: string) {
      t.lastLive = l;
    },
    end() {
      t.ended = true;
    },
  };
  return t;
};

/** One live line below append-only scrollback. Cursor movement is isolated here
 * so event formatting remains deterministic and testable. */
export class StreamTerm implements Term {
  #hasLive = false;
  constructor(private sink: Sink) {}
  #clearLive() {
    if (this.#hasLive) this.sink.write('\r\u001b[2K');
  }
  append(line: string): void {
    this.#clearLive();
    this.sink.write(`${line}\n`);
    this.#hasLive = false;
  }
  live(line: string): void {
    this.#clearLive();
    this.sink.write(`\r${line}`);
    this.#hasLive = true;
  }
  end(): void {
    if (!this.#hasLive) return;
    this.sink.write('\n');
    this.#hasLive = false;
  }
}

export class TtyReporter {
  #s = {
    done: 0,
    total: 0,
    passed: 0,
    failed: 0,
    optionalSkipped: 0,
    deferred: 0,
    start: 0,
    current: undefined as string | undefined,
    tick: 0,
    last: 0,
  };
  constructor(
    private term: Term,
    private opts: { unicode?: boolean; width?: number } = {}
  ) {}

  on: Observer = (e: RunnerEvent) => {
    this.#update(e);
    const l = lineFor(e, this.opts.unicode ?? true);
    if (l !== null) this.term.append(l);
    this.term.live(
      footer(
        { ...this.#s, elapsedMs: Math.max(0, this.#s.last - this.#s.start) },
        this.opts.width ?? 80,
        this.opts.unicode ?? true
      )
    );
    if (e.type === 'run.end') this.term.end();
  };

  #update(e: RunnerEvent) {
    this.#s.tick++;
    this.#s.last = e.t;
    switch (e.type) {
      case 'run.begin':
        this.#s.total = e.totalScenarios;
        this.#s.start = e.t;
        break;
      case 'scenario.begin':
        this.#s.current = `scenario ${e.id}`;
        break;
      case 'step.begin':
        this.#s.current = `[${e.stepId}] ${e.label}`;
        break;
      case 'assertion.begin':
        this.#s.current = `[${e.stepId}] ${e.label}`;
        break;
      case 'scenario.end':
        this.#s.done++;
        this.#s[e.ok ? 'passed' : 'failed']++;
        this.#s.current = undefined;
        break;
      case 'skip':
        this.#s.optionalSkipped++;
        break;
      case 'deferred':
        this.#s.done++;
        this.#s.deferred++;
        this.#s.current = undefined;
        break;
    }
  }
}
