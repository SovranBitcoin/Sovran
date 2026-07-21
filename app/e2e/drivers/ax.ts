/**
 * Pure accessibility-tree logic for the SimulatorDriver — no I/O, so it is unit
 * tested offline. The driver (simulator.ts) wires these to serve-sim's `/ax` SSE
 * stream and simctl. Mirrors the matching rules proven by the screenshot POC:
 * whitespace-normalized labels (the app's `₿ 100` thin space), exact id/label
 * beating a prefix, and an on-screen-center requirement so off-screen carousel
 * duplicates don't match.
 */
import type { Selector } from '../schema/selectors';
import type { AxNode, ObservedState } from './driver';
import { parseE2EActionMenuTarget } from '../../shared/lib/e2e/actionMenuTarget';
import { redactProfileSecretAxFields, redactProfileSecretAxNodes } from './ax-redaction';

export interface AxElement {
  id?: string;
  label?: string;
  role?: string;
  enabled?: boolean;
  value?: string;
  frame: { x: number; y: number; width: number; height: number };
}
export interface AxSnapshot {
  screen: { width: number; height: number };
  elements: AxElement[];
}

/** Resolve a physical tap centre. Ordinary elements use their AX frame. An
 * iOS FullWindowOverlay action mirror carries the real row's measured centre
 * in its non-secret AX value because that native overlay is absent from the
 * main window's AX tree. */
export function elementTapCenter(
  element: AxElement,
  screen: AxSnapshot['screen']
): { x: number; y: number } | null {
  const mirroredTarget = parseE2EActionMenuTarget(element.value);
  const x = mirroredTarget?.x ?? element.frame.x + element.frame.width / 2;
  const y = mirroredTarget?.y ?? element.frame.y + element.frame.height / 2;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > screen.width ||
    y > screen.height
  ) {
    return null;
  }
  return { x: x / screen.width, y: y / screen.height };
}

export const normalizeWs = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const IOS_CHECKED_CONTROL_VALUE = /^(?:radio button|checkbox|switch), (?:checked, 1|unchecked, 0)$/;

/** serve-sim receives VoiceOver's spoken composite for React Native checked
 * controls instead of the authored accessibilityValue. Recover the terminal
 * semantic bit only for the exact, internally-consistent control forms. */
const normalizeCheckedControlValue = (value: string | undefined): string | undefined => {
  if (!value || !IOS_CHECKED_CONTROL_VALUE.test(value)) return value;
  return value.endsWith(', 1') ? '1' : '0';
};

const onScreen = (el: AxElement, screen: AxSnapshot['screen']): boolean => {
  const cx = el.frame.x + el.frame.width / 2;
  const cy = el.frame.y + el.frame.height / 2;
  return cx >= 0 && cy >= 0 && cx <= screen.width && cy <= screen.height;
};

const ACTIVE_FLOW_ID_PREFIXES = [
  'amount-',
  'contact-row:mint:',
  'melt-',
  'mint-quote-id-',
  'native-share-',
  'onchain-send-id-',
  'payment-info-',
  'payment-request-',
  'payment-status-',
  'receive-',
  'send-',
];

const ACTIVE_FLOW_IDS = new Set([
  'flow-header-close',
  'p2pk-lock-indicator',
  'qr-density-control',
  'qr-speed-control',
  'screen-near-pay',
  'screen-payment-request',
  'slide-to-confirm',
]);

const isActiveFlowRoot = (el: AxElement): boolean => {
  const id = el.id ?? '';
  return ACTIVE_FLOW_IDS.has(id) || ACTIVE_FLOW_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
};

/**
 * Classify only an unambiguous foreground state. Navigator/modal AX trees can
 * retain wallet descendants behind the active payment surface, so the wallet
 * controls are evidence only when both are present and no known flow root is
 * on screen. Generic transaction copy such as "No History" is never a route
 * marker.
 */
export function classifyObservedState(snap: AxSnapshot | null): ObservedState {
  if (!snap) return 'unknown';
  const visible = snap.elements.filter((candidate) => onScreen(candidate, snap.screen));

  if (
    visible.some(
      (candidate) =>
        candidate.label === 'Welcome to Sovran' ||
        candidate.label === 'Get Started' ||
        candidate.label === 'I have read and agree to the Terms and Conditions'
    )
  ) {
    return 'onboarding';
  }

  if (visible.some(isActiveFlowRoot)) return 'unknown';

  const ids = new Set(visible.map((candidate) => candidate.id));
  return ids.has('wallet-receive') && ids.has('wallet-send') ? 'wallet' : 'unknown';
}

/** Does an element satisfy a selector? (exact id/label, or id prefix.) */
export function selectorMatches(el: AxElement, sel: Selector): boolean {
  if ('id' in sel) return el.id === sel.id;
  if ('idPrefix' in sel) return !!el.id && el.id.startsWith(sel.idPrefix);
  return normalizeWs(el.label) === normalizeWs(sel.label);
}

/** Find the best on-screen element for a selector: exact id/label wins over a
 *  prefix hit; only on-screen-center elements qualify. An indexed prefix is
 *  ordered top-to-bottom, then left-to-right, after duplicate ids are folded
 *  (crossfade lists can briefly expose the same row twice). */
export function findElement(snap: AxSnapshot, sel: Selector): AxElement | null {
  const visible = snap.elements.filter((e) => onScreen(e, snap.screen));
  const matches = visible.filter((e) => selectorMatches(e, sel));
  if (matches.length === 0) return null;
  if ('idPrefix' in sel) {
    const distinctIdCount = new Set(matches.map((match) => match.id)).size;
    if (sel.captureSuffixAs && sel.matchIndex === undefined && distinctIdCount > 1)
      throw new Error(`ambiguous id prefix capture "${sel.idPrefix}" (${distinctIdCount} matches)`);
    if (sel.matchIndex === undefined) {
      const match = matches[0];
      if (sel.captureSuffixAs && match.id === sel.idPrefix)
        throw new Error(`empty id suffix for prefix capture "${sel.idPrefix}"`);
      return match;
    }
    const seenIds = new Set<string | undefined>();
    const orderedMatches = [...matches]
      .sort((a, b) => {
        const vertical = a.frame.y - b.frame.y;
        if (vertical !== 0) return vertical;
        const horizontal = a.frame.x - b.frame.x;
        if (horizontal !== 0) return horizontal;
        return (a.id ?? '').localeCompare(b.id ?? '');
      })
      .filter((match) => {
        if (seenIds.has(match.id)) return false;
        seenIds.add(match.id);
        return true;
      });
    const match = orderedMatches[sel.matchIndex];
    if (!match) return null;
    if (sel.captureSuffixAs && match.id === sel.idPrefix)
      throw new Error(`empty id suffix for prefix capture "${sel.idPrefix}"`);
    return match;
  }
  // exact: prefer an element whose id/label equals exactly (already guaranteed)
  return matches[0];
}

export const toAxNode = (el: AxElement): AxNode => {
  const safe = redactProfileSecretAxFields(el);
  return {
    id: safe.id,
    label: safe.label ?? undefined,
    value: normalizeCheckedControlValue(safe.value ?? undefined),
    role: safe.role,
    state: { enabled: safe.enabled ?? true },
  };
};

/** Parse a `data: {...}` SSE line into a snapshot (null for keep-alive lines). */
export function parseSseData(line: string): AxSnapshot | null {
  if (!line.startsWith('data:')) return null;
  const body = line.slice(5).trim();
  if (!body) return null;
  try {
    const obj = JSON.parse(body);
    if (obj && obj.screen && Array.isArray(obj.elements)) {
      const snapshot = obj as AxSnapshot;
      return { ...snapshot, elements: redactProfileSecretAxNodes(snapshot.elements) };
    }
  } catch {
    /* partial/keep-alive */
  }
  return null;
}

/** Extract the sat amount from a wallet balance label like `₿ 100` / `-₿40`. */
export function parseBalanceSat(label: string | undefined): number | null {
  if (!label) return null;
  const m = normalizeWs(label).match(/-?₿\s*([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? (label.trim().startsWith('-') ? -n : n) : null;
}
