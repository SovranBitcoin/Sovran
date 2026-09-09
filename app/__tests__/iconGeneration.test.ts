import { readFileSync } from 'fs';
import path from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';

const scriptPath = path.join(process.cwd(), 'scripts/regenerate-icons.js');
const script = readFileSync(scriptPath, 'utf8');

async function runGenerator(fetch: () => Promise<unknown>) {
  const writeFileSync = jest.fn();
  const exit = jest.fn();
  const modules = {
    path,
    typescript: ts,
    fs: {
      readFileSync: () => "export const icons = ['mdi:check', 'mdi:close'];",
      existsSync: () => false,
      mkdirSync: jest.fn(),
      writeFileSync,
    },
  };
  await runInNewContext(script, {
    __dirname: path.dirname(scriptPath),
    require: (name: keyof typeof modules) => modules[name],
    fetch,
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    process: { stdout: { write: jest.fn() }, exit },
  });
  return { writeFileSync, exit };
}

test.each(['http', 'network', 'missing'])(
  '%s failure preserves the existing icon registry',
  async (failure) => {
    const result = await runGenerator(async () => {
      if (failure === 'network') throw new Error('offline');
      return {
        ok: failure !== 'http',
        status: 503,
        json: async () => ({ icons: { check: { body: '<path />' } } }),
      };
    });
    expect(result.exit).toHaveBeenCalledWith(1);
    expect(result.writeFileSync).not.toHaveBeenCalled();
  }
);

test('a complete response writes the JSON consumed by Icon', async () => {
  const result = await runGenerator(async () => ({
    ok: true,
    json: async () => ({
      width: 24,
      height: 24,
      icons: { check: { body: '<path d="M0 0" />' }, close: { body: '<path d="M1 1" />' } },
    }),
  }));
  expect(result.exit).not.toHaveBeenCalled();
  expect(result.writeFileSync).toHaveBeenCalledTimes(1);
  const [destination, json] = result.writeFileSync.mock.calls[0];
  expect(destination).toBe(path.join(process.cwd(), 'assets/icons/generated.json'));
  expect(JSON.parse(json)).toEqual({
    'mdi:check': {
      svg: '<svg viewBox="0 0 24 24" width="1em" height="1em" ><path d="M0 0" /></svg>',
      width: 16,
      height: 16,
    },
    'mdi:close': {
      svg: '<svg viewBox="0 0 24 24" width="1em" height="1em" ><path d="M1 1" /></svg>',
      width: 16,
      height: 16,
    },
  });
});
