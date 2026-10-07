import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyJournalMaps } from '../scripts/verify_service_archive.mjs';

const signature = 'retained-original-signature';
const records = () => ({
  [signature + '.signed.json']: 'a'.repeat(64),
  [signature + '.simulation.json']: 'b'.repeat(64),
  [signature + '.attempt-1.json']: 'c'.repeat(64),
  [signature + '.response-1.json']: 'd'.repeat(64),
});

test('offline journal review distinguishes missing historical maps from verified equality', () => {
  assert.deepEqual(verifyJournalMaps({}, signature), { archived: false, verified: false, files: 0 });
  const before = records();
  assert.deepEqual(verifyJournalMaps({ recoveryJournalBefore: before, recoveryJournalAfter: { ...before } }, signature),
    { archived: true, verified: true, files: 4 });
});

test('offline journal review rejects changed or partially retained recovery evidence', () => {
  const before = records(), after = { ...before, [signature + '.attempt-1.json']: 'e'.repeat(64) };
  assert.throws(() => verifyJournalMaps({ recoveryJournalBefore: before }, signature), /Both recovery journal maps/);
  assert.throws(() => verifyJournalMaps({ recoveryJournalBefore: before, recoveryJournalAfter: after }, signature), /Journal changed/);
  delete after[signature + '.signed.json'];
  assert.throws(() => verifyJournalMaps({ recoveryJournalBefore: before, recoveryJournalAfter: after }, signature), /lacks original signed wire/);
});

test('offline journal review requires original transaction records and valid hashes', () => {
  for (const malformed of [{}, { 'other.signed.json': 'a'.repeat(64) },
    { ...records(), [signature + '.signed.json']: 'invalid' },
    { ...records(), [signature + '../elsewhere.json']: 'a'.repeat(64) },
    { ...records(), [signature + '.unrecognized.json']: 'a'.repeat(64) }]) {
    assert.throws(() => verifyJournalMaps({ recoveryJournalBefore: malformed, recoveryJournalAfter: malformed }, signature));
  }
});
