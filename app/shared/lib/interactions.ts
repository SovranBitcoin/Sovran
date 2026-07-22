import { InteractionManager } from 'react-native';

/** Defer work until in-flight interactions/animations settle (e.g. a modal
 * dismissal). Thin seam over RN's InteractionManager so Node-env tests can
 * mock the deferral deterministically — jest module mocks of 'react-native'
 * do not reach the haste-resolved instance app modules import. */
export function runAfterInteractions(callback: () => void): void {
  InteractionManager.runAfterInteractions(callback);
}
