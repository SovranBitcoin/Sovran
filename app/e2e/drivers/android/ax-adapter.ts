/**
 * Pure uiautomator-XML → AxSnapshot adapter — no I/O, unit tested offline.
 * Feeds the SAME pure matching logic (ax.ts findElement / classifyObservedState)
 * the iOS driver uses, so selector semantics stay identical across platforms.
 *
 * Android AX realities this adapter encodes (verified against RN 0.85 source):
 * - RN testIDs surface as `resource-id` (ReactAccessibilityDelegate sets
 *   viewIdResourceName from the react_test_id tag) → AxElement.id.
 * - `accessibilityValue.text` does NOT get its own attribute: BaseViewManager
 *   appends it into contentDescription (", "-joined after any label). For
 *   id-carrying nodes with no `text`, content-desc is therefore ALSO exposed
 *   as `value` so value probes (transaction-probe-*) keep working; labeled
 *   elements' merged content-desc cannot be split reliably — Android
 *   scenarios must not value-assert labeled elements.
 * - Native Switch semantics ride `checkable`/`checked` → value '1'/'0',
 *   matching the iOS accessibilityValue convention the scenarios assert.
 */
import type { AxSnapshot, AxElement } from '../ax';
import { redactProfileSecretAxFields } from '../ax-redaction';

const decodeXmlEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&amp;', '&');

const parseBounds = (bounds: string): AxElement['frame'] | null => {
  const m = bounds.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!m) return null;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/** Strip the android platform namespace from native view ids
 * (`android:id/statusBarBackground` → kept verbatim minus nothing RN-owned:
 * RN testIDs arrive raw, so only exact-raw matching is ever performed). */
const attributesOf = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[match[1]!] = decodeXmlEntities(match[2]!);
  }
  return attrs;
};

export function parseUiautomatorXml(
  xml: string,
  screen?: { width: number; height: number }
): AxSnapshot {
  const elements: AxElement[] = [];
  let rootFrame: AxElement['frame'] | null = null;

  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = attributesOf(match[0]);
    const frame = attrs.bounds ? parseBounds(attrs.bounds) : null;
    if (!frame) continue;
    if (!rootFrame) rootFrame = frame;

    const id = attrs['resource-id'] || undefined;
    const text = attrs.text ?? '';
    const contentDesc = attrs['content-desc'] ?? '';
    const cls = attrs.class ?? '';
    const isEditable = attrs.editable === 'true' || /EditText/.test(cls);
    // An editable field (RN TextInput renders as EditText) echoes its current
    // content into `text`, mirroring iOS's accessibilityValue — so it is the
    // field's VALUE, and its accessible name is the content-desc/hint. Every
    // other node keeps text as its label.
    const label = isEditable ? contentDesc || undefined : text || contentDesc || undefined;

    let value: string | undefined;
    if (isEditable) {
      value = text;
    } else if (attrs.checkable === 'true') {
      value = attrs.checked === 'true' ? '1' : '0';
    } else if (id?.startsWith('transaction-probe-')) {
      // The transaction probe carries its JSON payload percent-encoded in
      // content-desc (a raw JSON label's commas/quotes/braces make Android drop
      // the content-desc entirely). Decode it back to the JSON the shared probe
      // parser expects; fall back to raw if it somehow isn't encoded.
      const raw = contentDesc || text || undefined;
      if (raw) {
        try {
          value = decodeURIComponent(raw);
        } catch {
          value = raw;
        }
      }
    } else if (id && !text && contentDesc) {
      // Probe convention: an id-only node's content-desc IS its value payload.
      value = contentDesc;
    }

    elements.push(
      redactProfileSecretAxFields({
        ...(id ? { id } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(value !== undefined ? { value } : {}),
        role: attrs.class || undefined,
        enabled: attrs.enabled !== 'false',
        frame,
      })
    );
  }

  const dims =
    screen ??
    (rootFrame ? { width: rootFrame.width, height: rootFrame.height } : { width: 0, height: 0 });
  return { screen: dims, elements };
}
