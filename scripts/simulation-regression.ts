import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ENCOUNTER_TIMES,
  runEncounterStates,
  type EncounterStates,
} from './simulation-checksum-lib';

/**
 * Headless fixed-step regression baseline for the visual world-continuity
 * phase. It imports only simulation modules (never rendering), runs the same
 * Encounter seed/warm-up as the browser capture, and emits the same state
 * checksum shape as `window.__blueCurrent.getSimulationSnapshot()`.
 *
 * Usage: npx tsx scripts/simulation-regression.ts
 *        npx tsx scripts/simulation-regression.ts --compare <artifact-dir>
 *        npx tsx scripts/simulation-regression.ts --fixture <fixture.json>
 */

const times = ENCOUNTER_TIMES;
const output = process.argv.find((value) => value.startsWith('--out='))
  ?.slice('--out='.length)
  ?? 'test-artifacts/world-continuity-p1/simulation-headless.json';
const legacy = process.argv.includes('--school-dynamics=legacy');
const legacyHabitat = process.argv.includes('--habitat=legacy');

const first = runEncounterStates({
  times,
  legacySchoolDynamics: legacy,
  legacyHabitat: legacyHabitat,
});
const second = runEncounterStates({
  times,
  legacySchoolDynamics: legacy,
  legacyHabitat: legacyHabitat,
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  scenario: 'encounter',
  times,
  deterministic: JSON.stringify(first) === JSON.stringify(second),
  states: first,
}, null, 2)}\n`);
console.log(`deterministic=${JSON.stringify(first) === JSON.stringify(second)}`);
for (const time of times) {
  console.log(`${time.toFixed(2)}s`, first[time.toFixed(2)].checksum, 'alive', first[time.toFixed(2)].aliveCount);
}

const compareArgument = process.argv.find((value) => value.startsWith('--compare='));
if (compareArgument) {
  const directory = compareArgument.slice('--compare='.length);
  let failures = 0;
  for (const time of times) {
    const path = `${directory}/state-t${time.toFixed(2)}.json`;
    if (!existsSync(path)) {
      console.log(`missing ${path}`);
      failures += 1;
      continue;
    }
    const browser = JSON.parse(readFileSync(path, 'utf8')) as { checksum: string };
    const node = first[time.toFixed(2)].checksum;
    const match = browser.checksum === node;
    console.log(`${time.toFixed(2)}s browser=${browser.checksum} node=${node} ${match ? 'MATCH' : 'MISMATCH'}`);
    if (!match) failures += 1;
  }
  if (failures > 0) process.exitCode = 1;
}

const fixtureArgument = process.argv.find((value) => value.startsWith('--fixture='));
if (fixtureArgument) {
  const path = fixtureArgument.slice('--fixture='.length);
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as {
    dynamic?: { states?: EncounterStates };
  };
  const expected = fixture.dynamic?.states ?? {};
  let failures = 0;
  for (const time of times) {
    const key = time.toFixed(2);
    const match = JSON.stringify(expected[key]) === JSON.stringify(first[key]);
    console.log(`${key}s fixture=${expected[key]?.checksum ?? 'missing'} node=${first[key].checksum} ${match ? 'MATCH' : 'MISMATCH'}`);
    if (!match) failures += 1;
  }
  if (failures > 0) process.exitCode = 1;
}
