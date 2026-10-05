import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateDeployment, canonicalHash } from './deployment.mjs';
import { REPO, ensure, loopbackEndpoint, TOKEN_PROGRAM } from '../../local-client/src/runtime.mjs';

const runtimePrograms = ['Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ', 'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'];

/** Circuit upload receipts make deployment archives larger than operation/session files. */
export async function readDeploymentResults(filename) {
  const path = resolve(filename);
  ensure(path.startsWith(resolve(REPO, '.local') + '/') && await realpath(path) === path, 'Expected nonsymlink local deployment archive');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.size > 0 && stat.size < 64 * 1024 * 1024,
      'Expected private bounded deployment archive');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

/** Public, allowlisted metadata only. No initializer values become observer disclosures. */
export function policyBootstrap(instance, results, release) {
  ensure(instance?.schema === 1 && instance.passed === true, 'Require completed custom policy instance');
  const descriptor = validateDeployment(instance.descriptor), { releaseHashHex, ...body } = release;
  ensure(releaseHashHex === descriptor.releaseHashHex && canonicalHash(body) === releaseHashHex, 'Policy release manifest identity mismatch');
  ensure(release.schemaHashHex === descriptor.schemaHashHex && canonicalHash(release.package?.stateFields) === canonicalHash(descriptor.stateFields), 'Policy release schema mismatch');
  ensure(release.package?.profile === descriptor.profile && /^[a-z][a-z0-9-]{0,47}$/.test(release.package?.name), 'Malformed policy package identity');
  ensure(!instance.policyName || instance.policyName === release.package.name, 'Policy name differs from authenticated package manifest');
  ensure(results?.passed === true && results.phase === 'ready' && results.genesisHash === descriptor.genesisHash && results.releaseHashHex === descriptor.releaseHashHex, 'Custom deployment is incomplete or belongs to another release');
  ensure(canonicalHash(results.descriptor) === canonicalHash(descriptor), 'Instance differs from completed deployment descriptor');
  const expected = new Set([descriptor.programs.auth, descriptor.programs.policy, descriptor.programs.guard, descriptor.programs.merchant,
    descriptor.programs.license, descriptor.programs.proofBuffer, TOKEN_PROGRAM, ...runtimePrograms]);
  ensure(expected.size === 10 && results.loadedPrograms?.length === 10, 'Require ten custom deployment program reports');
  for (const report of results.loadedPrograms) {
    ensure(expected.delete(report.program) && report.matched === true && report.genesis_hash === descriptor.genesisHash,
      'Loaded program report set differs from custom deployment');
    ensure(typeof report.local_elf_path === 'string' && /^[a-f0-9]{64}$/.test(report.elf_sha256) && report.loaded_elf_sha256 === report.elf_sha256, 'Malformed custom program provenance');
  }
  ensure(expected.size === 0, 'Missing custom deployment program');
  loopbackEndpoint(instance.endpoint);
  return { ...instance, genesisHash: descriptor.genesisHash, bootstrapDirectory: dirname(resolve(instance.results)),
    loadedPrograms: results.loadedPrograms, policyName: release.package.name,
    policy: { name: release.package.name, release: descriptor.releaseHashHex, schema: descriptor.schemaHashHex,
      state: descriptor.quota, auth: descriptor.programs.auth, domain: descriptor.domainHashHex } };
}

