/**
 * Minimal .env loader (no dependency on dotenv).
 *
 * Parses KEY=VALUE lines, strips matching surrounding quotes, and unescapes
 * literal "\n" sequences so a single-line PEM key round-trips. Pure parsing is
 * exported separately from the filesystem read so it can be unit-tested.
 */

import fs from 'fs';

/** Parse the contents of a .env file into a plain object. Pure. */
export function parseEnv(content) {
  const out = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value.replace(/\\n/g, '\n');
  }
  return out;
}

/** Load a .env file into process.env (existing values win). Returns the parsed map. */
export function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const parsed = parseEnv(fs.readFileSync(envPath, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}
