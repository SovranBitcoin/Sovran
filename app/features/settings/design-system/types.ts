/**
 * @fileoverview Design-system catalog shapes.
 *
 * Leaf module: every scenario file is typed by these and the catalog imports
 * every scenario file, so the shapes cannot live in the catalog.
 */
import type { Href } from 'expo-router';
import type { ReactElement } from 'react';

/** One discrete state a fixture locks a component in, for the state-locked UI kit. */
export type DesignSystemComponentState =
  | 'default'
  | 'loading'
  | 'empty'
  | 'populated'
  | 'error'
  | 'offline'
  | 'disabled'
  | 'selected'
  | 'worst-case'
  | 'large-text';

export interface DesignSystemScenario {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly string[];
  /** The component this scenario locks, by its exported name. */
  readonly component?: string;
  /** The state it is locked in. */
  readonly state?: DesignSystemComponentState;
  render(): ReactElement;
}

export interface DesignSystemFamily {
  readonly id: string;
  readonly href: Href;
  readonly title: string;
  readonly description: string;
  readonly scenarios: readonly DesignSystemScenario[];
}
