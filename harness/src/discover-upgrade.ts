import { inventory } from './upgrade';
const root = process.argv[2];
if (!root) throw new Error('Usage: bun discover.ts <trusted-repository-root>');
process.stdout.write(`${JSON.stringify(await inventory(root))}\n`);
