import { describe, expect, it } from 'vitest';
import fixture from './fixtures/encounter-checksums.json';
import {
  D026_DYNAMIC_CHECKSUMS,
  ENCOUNTER_TIMES,
  PRE_E2_CHECKSUM,
  PRE_E2_FISH_CHECKSUM,
  runEncounterStates,
} from '../scripts/simulation-checksum-lib';

describe('encounter checksum fixture', () => {
  it('reproduces every D026 dynamic encounter state', () => {
    const states = runEncounterStates();
    for (const time of ENCOUNTER_TIMES) {
      const key = time.toFixed(2);
      expect(states[key]).toEqual(fixture.dynamic.states[key as keyof typeof fixture.dynamic.states]);
      expect(states[key].checksum).toBe(D026_DYNAMIC_CHECKSUMS[key]);
    }
  }, 180000);

  it('reproduces the pre-E2 legacy encounter pair', () => {
    const states = runEncounterStates({
      times: [17],
      legacySchoolDynamics: true,
      legacyHabitat: true,
    });
    expect(states['17.00']).toEqual(fixture.legacyPreE2.states['17.00']);
    expect(states['17.00'].fishChecksum).toBe(PRE_E2_FISH_CHECKSUM);
    expect(states['17.00'].checksum).toBe(PRE_E2_CHECKSUM);
  }, 60000);

  it('records the convention used to generate the fixture', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.scenario).toBe('encounter');
    expect(fixture.times).toEqual([...ENCOUNTER_TIMES]);
    expect(fixture.convention.seed).toBe('0x9e71c0de');
    expect(fixture.convention.warmupSteps).toBe(150);
    expect(fixture.constants.dynamic).toEqual(D026_DYNAMIC_CHECKSUMS);
    expect(fixture.constants.preE2).toEqual({
      fishChecksum: PRE_E2_FISH_CHECKSUM,
      checksum: PRE_E2_CHECKSUM,
    });
  });
});
