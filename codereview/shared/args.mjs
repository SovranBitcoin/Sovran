/**
 * CLI-arg helpers shared by analyze-structure and lookalikes.
 *
 * The two scripts share a convention: numeric tuning flags
 * (`--threshold N`, `--depth K`) where the value is the next argv slot.
 * Boolean toggles (`--no-foo`, `--foo`) are read with plain `args.includes`.
 */

/**
 * Parse a numeric flag (`--name N`) from argv.
 * Returns `defaultVal` when the flag is absent or the value is not numeric.
 */
export function getNumericArg(args, flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const val = parseFloat(args[idx + 1]);
  return Number.isNaN(val) ? defaultVal : val;
}

/**
 * Parse a string flag (`--name value`) from argv.
 * Returns `defaultVal` when the flag is absent or has no value following it.
 */
export function getStringArg(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const val = args[idx + 1];
  if (val.startsWith('--')) return defaultVal;
  return val;
}
