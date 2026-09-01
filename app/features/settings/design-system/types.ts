/**
 * @fileoverview Design-system catalog shapes.
 *
 * Leaf module: every scenario file is typed by these and the catalog imports
 * every scenario file, so the shapes cannot live in the catalog.
 */
import type { Href } from 'expo-router';
import type { ReactElement } from 'react';

export interface DesignSystemScenario {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly string[];
  render(): ReactElement;
}

export interface DesignSystemFamily {
  readonly id: string;
  readonly href: Href;
  readonly title: string;
  readonly description: string;
  readonly scenarios: readonly DesignSystemScenario[];
}
