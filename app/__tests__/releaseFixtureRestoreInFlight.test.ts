/** @jest-environment node */
import './releaseFixtures/launch';
import { declaredCases, selectCases } from './releaseFixtures/cases';
import { registerUpgradeCases } from './releaseFixtures/upgradeSuite';

registerUpgradeCases(
  process.env.PERSISTENCE_SELECTION === 'baselines'
    ? []
    : selectCases(declaredCases(), {
        epoch: process.env.PERSISTENCE_EPOCH,
        store: process.env.PERSISTENCE_STORE,
        case: process.env.PERSISTENCE_CASE,
        version: process.env.PERSISTENCE_VERSION,
      })
);
