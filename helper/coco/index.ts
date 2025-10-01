/**
 * Coco Cashu Integration
 * 
 * This module provides a complete integration with the coco-cashu libraries,
 * replacing the complex Redux-based cashuClient.ts approach with a clean,
 * maintainable architecture.
 */

// Core manager and migration
export { CocoManager } from './manager';
export { DataMigration } from './migration';
export { CocoProvider, useCocoContext } from './CocoProvider';

// Re-export types
export type { MigrationResult, MigrationError } from './migration';
