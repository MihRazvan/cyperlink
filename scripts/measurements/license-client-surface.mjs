#!/usr/bin/env node
/** Reproducible source-surface accounting. Counts are not developer productivity. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..'), output = process.argv[2];
if (!output) throw Error('Usage: license-client-surface.mjs NEW_OUTPUT');
async function sources(path, extensions) {
 const files = [];
 for (const item of await readdir(resolve(root, path), { withFileTypes: true })) {
   if (item.name.startsWith('.') || ['target', 'node_modules'].includes(item.name)) continue;
   const name = `${path}/${item.name}`;
   if (item.isDirectory()) files.push(...await sources(name, extensions));
   else if (extensions.some(ext => name.endsWith(ext))) files.push(name);
 }
 return files.sort();
}
async function group(label, names, note) {
 const files = await Promise.all(names.map(async path => { const bytes = await readFile(resolve(root, path)); return {
  path, bytes: bytes.length, physicalLines: bytes.toString().split('\n').length - (bytes.at(-1) === 10 ? 1 : 0),
  sha256: createHash('sha256').update(bytes).digest('hex') }; }));
 return { label, note, totals: { files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), physicalLines: files.reduce((n, f) => n + f.physicalLines, 0) }, files };
}
const groups = [
 await group('preserved-reference-application', ['examples/license-app/app.mjs'], 'Original application includes CLI parsing/outcome projection and app-owned recovery worker/ticket plumbing.'),
 await group('session-application', ['examples/license-session/app.mjs'], 'Uses generated bindings and imports parser/view from the preserved reference; that whole additional file is counted separately, not hidden.'),
 await group('direct-client', ['examples/license-direct/app.mjs', 'examples/license-direct/abi.mjs', 'examples/license-direct/wire.mjs'], 'Direct operation-specific runtime implementation; denser formatting makes line-count ratios misleading.'),
 await group('shared-customer-policy', ['examples/license-app/policy.rs', 'examples/license-app/policy.json', 'examples/license-app/tests.json'], 'Same customer rules/manifest/host vectors on both sides; generated artifacts excluded.'),
 await group('sdk-source-surface', (await Promise.all(['packages/policy-client/src', 'packages/local-client/src', 'packages/sdk/src'].map(p => sources(p, ['.mjs'])))).flat(), 'Entire source directories, including features not exercised in this operation. Shared SDK work is not zero; this is not an exact execution dependency closure.'),
 await group('shared-native-proof-bridge', await sources('crates/client-proofs', ['.rs']), 'Includes vendored upstream proof-generation adaptation; Cargo dependencies/toolchains are additional shared work, not measured here.'),
 await group('shared-onchain-implementation', (await Promise.all(['programs/custom-policy', 'crates/native-admission', 'crates/hook-routing', 'crates/pda-provisioning', 'crates/custom-policy-layout'].map(p => sources(p, ['.rs'])))).flat(), 'Shared reviewed enforcement. Direct client does not replace these programs/crates. Upstream dependencies and generated per-deployment constants excluded.'),
];
const result = { schema: 1, classification: 'source-surface-accounting-not-productivity', generatedAt: new Date().toISOString(), groups,
 limitations: ['Source bytes and physical lines do not measure human time, expertise, security, maintenance cost or customer advantage.',
 'Shared policy/compiler/deployment/funded-asset provisioning/native bridge/enforcement/runtime are not a standalone upstream comparison.',
 'Both implementations used internal source assistance/review. Qualification/tests/docs are excluded from runtime groups and remain additional work.',
 'Generated bindings, compiler/toolchain and external pinned package source are excluded; whole SDK directories include unexercised modules. No ratio is a measured saving.'] };
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output: relative(root, resolve(output)), groups: groups.map(g => ({ label: g.label, ...g.totals })) }));
