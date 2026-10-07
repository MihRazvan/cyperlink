import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ROOT, PROFILE, CIPHER, canonical, sha, schemaDigest, defaultManifest,
  validateManifest, initPackage, testPackage, buildPackage, readRelease,
  command, repairPackage,
} from '../src/package.mjs';

test('manifest schema rejects unsupported private inputs, outputs, authority and malformed fields', () => {
  assert.equal(validateManifest(defaultManifest('novel-rule', ['units', 'reward'])).profile, PROFILE);
  const mutations = [
    manifest => { manifest.stateFields = []; },
    manifest => { manifest.stateFields = ['a', 'b', 'c', 'd', 'e'].map(name => ({ name, type: 'u64' })); },
    manifest => { manifest.stateFields = [{ name: 'remaining', type: 'u64' }, { name: 'remaining', type: 'u64' }]; },
    manifest => { manifest.stateFields[0].name = 'Remaining'; },
    manifest => { manifest.stateFields[0].type = 'u128'; },
    manifest => { manifest.stateFields[0].public = false; },
    manifest => { manifest.inputs.additional = ['unchecked_amount']; },
    manifest => { manifest.inputs.nativePayment = 'delegate'; },
    manifest => { manifest.disclosure.push('plaintextSuccessor'); },
    manifest => { manifest.queryAuthorization = 'automatic'; },
    manifest => { manifest.initialization.authority = 'anyone'; },
    manifest => { manifest.initialization.mode = 'reset'; },
    manifest => { manifest.compiler.arcis = 'latest'; },
    manifest => { manifest.compiler.cipher = 'base255'; },
    manifest => { manifest.entrypoint = '../policy.rs'; },
    manifest => { manifest.extra = true; },
  ];
  for (const mutate of mutations) {
    const manifest = defaultManifest('novel-rule'); mutate(manifest);
    assert.throws(() => validateManifest(manifest));
  }
});

test('canonical package identity sorts object keys but preserves ordered state schema', () => {
  assert.equal(canonical({ z: [{ b: 1, a: 2 }], a: true }), canonical({ a: true, z: [{ a: 2, b: 1 }] }));
  const a = [{ name: 'remaining', type: 'u64' }, { name: 'reserve', type: 'u64' }];
  assert.notEqual(schemaDigest(a), schemaDigest([...a].reverse()));
  assert.notEqual(schemaDigest(a), schemaDigest([{ name: 'remaining', type: 'u64' }]));
  assert.match(schemaDigest(a), /^[a-f0-9]{64}$/);
  assert.equal(CIPHER, 'cspl-rescue-scalar253-v1');
});

test('real package compiler, generated bindings, copied-directory identity and tamper checks', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(ROOT, '.local/policy-cli-test-'));
  try {
    const app = join(temporary, 'app');
    await initPackage(app);
    await assert.rejects(initPackage(app), { code: 'EEXIST' });
    const tested = await testPackage(app);
    assert.equal(tested.passed, true);
    assert.equal(tested.evidence, 'host-IR-only-not-distributed');
    const built = await buildPackage(app);
    assert.equal(built.evidence, 'compiled-artifacts-not-runtime');
    const repeated = await buildPackage(app);
    assert.equal(repeated.releaseHashHex, built.releaseHashHex, 'an identical source rebuild must retain release identity');
    assert.equal(repeated.releaseDirectory, built.releaseDirectory, 'an identical release must be reusable');
    // Other agents can edit on-chain sources concurrently. This acceptance group
    // tests customer/package/artifact identity, with platform drift tested below.
    const original = await readRelease(app, { checkPlatform: false });
    assert.equal(original.release.releaseHashHex, built.releaseHashHex);
    assert.equal(Object.keys(original.release.artifacts).length, 8);
    const qualified = await readRelease(app, { checkPlatform: false, requireTests: true });
    assert.equal(qualified.qualification.passed, true);
    assert.equal(qualified.qualification.releaseHashHex, built.releaseHashHex);
    const currentPath = join(app, '.cyperlink/current.json');
    const qualifiedCurrent = await readFile(currentPath);
    const testsPath = join(app, 'tests.json'), tests = await readFile(testsPath);
    await writeFile(testsPath, '[]');
    await assert.rejects(readRelease(app, { checkPlatform: false, requireTests: true }), /Tests changed/);
    await assert.rejects(buildPackage(app), /failed/);
    assert.deepEqual(await readFile(currentPath), qualifiedCurrent, 'failed host tests must never publish a new current release');
    await writeFile(testsPath, tests);
    // Legacy release identity remains readable; only NEW deployments require tests.
    await writeFile(currentPath, JSON.stringify({ releaseHashHex: built.releaseHashHex }));
    assert.equal((await readRelease(app, { checkPlatform: false })).qualification, undefined);
    await assert.rejects(readRelease(app, { checkPlatform: false, requireTests: true }), /no bound host tests/);
    const environment = join(temporary, 'preparation.json');
    await writeFile(environment, JSON.stringify({ profile: 'provisioned161', rpc: 'http://127.0.0.1:8899' }));
    const { deployPackage } = await import('../src/deploy.mjs');
    await assert.rejects(deployPackage(app, { local: true, '--environment': environment,
      '--initial-state': join(temporary, 'not-read.json'), '--out': join(temporary, 'not-created') }), /no bound host tests/);
    await assert.rejects(readFile(join(temporary, 'not-created/results.json')), { code: 'ENOENT' });

    await writeFile(currentPath, qualifiedCurrent);

    assert.match(await readFile(join(app, '.cyperlink/bindings.d.mts'), 'utf8'), /remaining: bigint/);
    const bindings = await readFile(join(app, '.cyperlink/bindings.mjs'), 'utf8');
    assert(bindings.includes(built.releaseHashHex));
    assert.match(bindings, /different policy release/);
    // Simulate interruption between binding publication and pointer publication:
    // repair must reproduce the exact old binding bytes without a compiler/RPC.
    await writeFile(join(app, '.cyperlink/bindings.mjs'), '// incomplete generation');
    const repaired = await repairPackage(app);
    assert.equal(repaired.transactions, 0);
    assert.equal(await readFile(join(app, '.cyperlink/bindings.mjs'), 'utf8'), bindings);
    assert.deepEqual(await readFile(currentPath), qualifiedCurrent);

    // Fault the second binding publication after immutable release/qualification
    // publication. Readers retain the previous current pointer; explicit repair
    // recovers after the filesystem issue is removed, with no recompilation.
    const declaration = join(app, '.cyperlink/bindings.d.mts');
    await rename(declaration, declaration + '.saved');
    await mkdir(declaration);
    await assert.rejects(buildPackage(app), /EISDIR|ENOTDIR|EPERM/);
    assert.deepEqual(await readFile(currentPath), qualifiedCurrent);
    assert.equal((await readRelease(app, { checkPlatform: false, requireTests: true })).release.releaseHashHex, built.releaseHashHex);
    await rm(declaration, { recursive: true });
    await rename(declaration + '.saved', declaration);
    await repairPackage(app);
    assert.equal(await readFile(join(app, '.cyperlink/bindings.mjs'), 'utf8'), bindings);
    const qualificationPath = join(app, '.cyperlink/qualifications', JSON.parse(qualifiedCurrent).qualificationHashHex, 'test.log');
    const retainedLog = await readFile(qualificationPath);
    await writeFile(qualificationPath, 'changed evidence');
    await assert.rejects(readRelease(app, { checkPlatform: false, requireTests: true }), /Retained test log changed/);
    await writeFile(qualificationPath, retainedLog);

    assert(!canonical(original.release).includes(temporary), 'machine source/output paths must not define release identity');

    const relocated = join(temporary, 'relocated');
    await cp(app, relocated, { recursive: true });
    assert.equal((await readRelease(relocated, { checkPlatform: false })).release.releaseHashHex, built.releaseHashHex);

    const sourcePath = join(app, 'policy.rs'), source = await readFile(sourcePath);
    await writeFile(sourcePath, Buffer.concat([source, Buffer.from('\n// A new source revision\n')]));
    await assert.rejects(readRelease(app, { checkPlatform: false }), /Source changed/);
    await writeFile(sourcePath, source);

    const manifestPath = join(app, 'policy.json'), manifest = await readFile(manifestPath);
    const modifiedManifest = JSON.parse(manifest); modifiedManifest.name = 'different-rule';
    await writeFile(manifestPath, JSON.stringify(modifiedManifest));
    await assert.rejects(readRelease(app, { checkPlatform: false }), /Package manifest changed/);
    await writeFile(manifestPath, manifest);

    const artifactPath = join(original.releaseDirectory, 'circuits/runtime_policy_evaluate.arcis');
    const artifact = await readFile(artifactPath), damaged = Buffer.from(artifact); damaged[damaged.length - 1] ^= 1;
    await writeFile(artifactPath, damaged);
    await assert.rejects(readRelease(app, { checkPlatform: false }), /Artifact bytes changed/);
    await writeFile(artifactPath, artifact);

    const releasePath = join(original.releaseDirectory, 'release.json'), releaseBytes = await readFile(releasePath);
    const altered = JSON.parse(releaseBytes); altered.schemaHashHex = '00'.repeat(32);
    await writeFile(releasePath, JSON.stringify(altered));
    await assert.rejects(readRelease(app, { checkPlatform: false }), /Release manifest was altered/);
    await writeFile(releasePath, releaseBytes);

    // Re-signing a local JSON hash does not evade the independent current-source
    // comparison. This is not a claim hashes replace deployment authority.
    const { releaseHashHex: unused, ...body } = original.release;
    body.platformSources = { ...body.platformSources, 'unrecognized/source.rs': '00'.repeat(32) };
    const changedHash = sha(canonical(body));
    const changedDirectory = join(app, '.cyperlink/releases', changedHash);
    await cp(original.releaseDirectory, changedDirectory, { recursive: true });
    await writeFile(join(changedDirectory, 'release.json'), JSON.stringify({ ...body, releaseHashHex: changedHash }));
    await writeFile(join(app, '.cyperlink/current.json'), JSON.stringify({ releaseHashHex: changedHash }));
    await assert.rejects(readRelease(app), /Platform source changed/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('failed diagnostic persistence rejects the command instead of losing completion', { timeout: 10_000 }, async () => {
  const temporary = await mkdtemp(join(ROOT, '.local/policy-cli-command-test-'));
  try {
    await assert.rejects(command(process.execPath, ['-e', 'process.stdout.write("completed")'], {
      log: join(temporary, 'missing-directory', 'command.log'),
    }), { code: 'ENOENT' });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('actual Rust compilation rejects unsupported author expressions and source/schema mismatch', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(ROOT, '.local/policy-cli-negative-test-'));
  try {
    const app = join(temporary, 'app'); await initPackage(app);
    const sourcePath = join(app, 'policy.rs'), source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace('ctx.sub(remaining, amount)', 'ctx.divide(remaining, amount)'));
    let unsupported;
    try { await testPackage(app); } catch (error) { unsupported = error; }
    assert(unsupported, 'unsupported private operation must fail compilation');
    const unsupportedLog = unsupported.message.match(/inspect (.+)$/)?.[1];
    assert(unsupportedLog, 'compiler failure should retain a concrete diagnostic log');
    assert.match(await readFile(unsupportedLog, 'utf8'), /no method named `divide`/);
    await writeFile(sourcePath, source.replace('&["remaining"]', '&["another"]'));
    let mismatch;
    try { await testPackage(app); } catch (error) { mismatch = error; }
    assert(mismatch, 'source and manifest field order must agree');
    const mismatchLog = mismatch.message.match(/inspect (.+)$/)?.[1];
    assert(mismatchLog);
    assert.match(await readFile(mismatchLog, 'utf8'), /Source FIELDS differs from manifest schema/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
