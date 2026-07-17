/**
 * Null-rendering mount point for the e2e state mirror. Renders nothing and
 * does nothing unless the harness-owned Metro env enables the mirror (see
 * stateMirror.ts for the gate and the security posture).
 */
import { useEffect } from 'react';

import { isStateMirrorEnabled, startStateMirror } from './stateMirror';

export function E2EStateMirror(): null {
  useEffect(() => {
    if (!isStateMirrorEnabled()) return undefined;
    return startStateMirror();
  }, []);
  return null;
}
