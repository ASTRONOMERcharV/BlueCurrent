import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  D026_DYNAMIC_CHECKSUMS,
  ENCOUNTER_TIMES,
  PRE_E2_CHECKSUM,
  PRE_E2_FISH_CHECKSUM,
  runEncounterStates,
  type EncounterStates,
} from './simulation-checksum-lib';

const fixturePath = 'tests/fixtures/encounter-checksums.json';
const writeMode = process.argv.includes('--write');
const newBaseline = process.argv.includes('--new-baseline');

interface Fixture {
  schemaVersion: number;
  scenario: 'encounter';
  times: number[];
  convention: Record<string, unknown>;
  environment: Record<string, unknown>;
  dynamic: { states: EncounterStates };
  legacyPreE2: {
    times: number[];
    flags: Record<string, boolean>;
    states: EncounterStates;
  };
  constants: {
    dynamic: Record<string, string>;
    preE2: { fishChecksum: string; checksum: string };
  };
}

const legacyTimes = [17];

function fail(message: string): never {
  console.error(`fixture check failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch\nactual:   ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  }
}

function validateConstants(dynamic: EncounterStates, legacy: EncounterStates): void {
  for (const time of ENCOUNTER_TIMES) {
    const key = time.toFixed(2);
    const expected = D026_DYNAMIC_CHECKSUMS[key];
    if (!expected) fail(`no D026 constant for ${key}`);
    if (dynamic[key]?.checksum !== expected) {
      fail(`${key} dynamic checksum ${dynamic[key]?.checksum ?? 'missing'} != ${expected}`);
    }
  }
  if (legacy['17.00']?.fishChecksum !== PRE_E2_FISH_CHECKSUM) {
    fail(`legacy fish checksum ${legacy['17.00']?.fishChecksum ?? 'missing'} != ${PRE_E2_FISH_CHECKSUM}`);
  }
  if (legacy['17.00']?.checksum !== PRE_E2_CHECKSUM) {
    fail(`legacy checksum ${legacy['17.00']?.checksum ?? 'missing'} != ${PRE_E2_CHECKSUM}`);
  }
}

function buildFixture(dynamic: EncounterStates, legacy: EncounterStates): Fixture {
  const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  return {
    schemaVersion: 1,
    scenario: 'encounter',
    times: [...ENCOUNTER_TIMES],
    convention: {
      seed: '0x9e71c0de',
      warmupSteps: 150,
      fixedDelta: '1/60',
      initialFishCount: 500,
      initialClownfishCount: 100,
      predator: 'disabled during warmup, released once',
      obstaclesEnabled: true,
      searchMode: 'grid',
      stepRule: 'step until totalSteps >= round(seconds * 60)',
      legacyPreE2: 'schoolDynamics=false + habitat=legacy, 1020 steps',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      v8: process.versions.v8,
      packageVersion,
    },
    dynamic: { states: dynamic },
    legacyPreE2: {
      times: legacyTimes,
      flags: { legacySchoolDynamics: true, legacyHabitat: true },
      states: legacy,
    },
    constants: {
      dynamic: { ...D026_DYNAMIC_CHECKSUMS },
      preE2: { fishChecksum: PRE_E2_FISH_CHECKSUM, checksum: PRE_E2_CHECKSUM },
    },
  };
}

function runBoth(): { dynamic: EncounterStates; legacy: EncounterStates } {
  const dynamic = runEncounterStates();
  const legacy = runEncounterStates({
    times: legacyTimes,
    legacySchoolDynamics: true,
    legacyHabitat: true,
  });
  validateConstants(dynamic, legacy);
  return { dynamic, legacy };
}

if (writeMode) {
  if (!newBaseline) fail('--write requires --new-baseline (the fixture cannot be reblessed silently)');
  const first = runBoth();
  const second = runBoth();
  assertEqual('dynamic repeat', second.dynamic, first.dynamic);
  assertEqual('legacy repeat', second.legacy, first.legacy);
  const fixture = buildFixture(first.dynamic, first.legacy);
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${fixturePath}`);
  console.log(`dynamic: ${ENCOUNTER_TIMES.map((time) => first.dynamic[time.toFixed(2)].checksum).join(' ')}`);
  console.log(`legacy: ${first.legacy['17.00'].checksum}`);
} else {
  if (!existsSync(fixturePath)) fail(`missing ${fixturePath}; run --write --new-baseline once`);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  const current = runBoth();
  assertEqual('fixture schemaVersion', fixture.schemaVersion, 1);
  assertEqual('fixture scenario', fixture.scenario, 'encounter');
  assertEqual('fixture times', fixture.times, [...ENCOUNTER_TIMES]);
  assertEqual('dynamic states', current.dynamic, fixture.dynamic.states);
  assertEqual('legacy states', current.legacy, fixture.legacyPreE2.states);
  assertEqual('dynamic constants', D026_DYNAMIC_CHECKSUMS, fixture.constants.dynamic);
  assertEqual('pre-E2 constants', {
    fishChecksum: PRE_E2_FISH_CHECKSUM,
    checksum: PRE_E2_CHECKSUM,
  }, fixture.constants.preE2);
  console.log('fixture check passed');
  console.log(`dynamic: ${ENCOUNTER_TIMES.map((time) => current.dynamic[time.toFixed(2)].checksum).join(' ')}`);
  console.log(`legacy: ${current.legacy['17.00'].checksum}`);
}
