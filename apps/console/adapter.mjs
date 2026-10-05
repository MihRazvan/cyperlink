import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat, open } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { descriptorDigest, canonicalHash, validateOperation } from '../../packages/policy-client/src/index.mjs';
import { decimal } from '../../packages/policy-client/src/operation-plan.mjs';
import { policyBootstrap, readDeploymentResults } from '../../packages/policy-client/src/local-deployment.mjs';
import { privateJson, sessionDirectory } from '../../packages/local-client/src/private-store.mjs';
import { REPO, ensure, writeNew } from '../../packages/local-client/src/runtime.mjs';

const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });

/** Only explicit paths configure a role. No key contents are read here. */
export function projectMetadata(instance, { administratorKeyfile, ownerKeyfiles = {} } = {}) {
  ensure(ownerKeyfiles && typeof ownerKeyfiles === 'object' && !Array.isArray(ownerKeyfiles), 'Expected explicit owner key paths');
  for (const [role, path] of Object.entries(ownerKeyfiles)) ensure(['a', 'b'].includes(role) && typeof path === 'string' && path.length > 0, 'Invalid owner key path');
  ensure(administratorKeyfile === undefined || typeof administratorKeyfile === 'string' && administratorKeyfile.length > 0, 'Invalid administrator key path');
  const sources = ['a', 'b'].map((id, index) => ({ id, label: `Wallet ${index ? 'B' : 'A'}`, canSign: Boolean(ownerKeyfiles[id]) }));
  const administratorConfigured = Boolean(administratorKeyfile);
  return { name: instance.policyName, release: instance.descriptor.releaseHashHex, profile: instance.descriptor.profile,
    genesis: instance.descriptor.genesisHash, deploymentHash: descriptorDigest(instance.descriptor),
    network: 'Local Solana', sources, signingEnabled: administratorConfigured && sources.some(source => source.canSign), administratorConfigured };
}

/** Generated bindings are executable local code: accept only the exact generator output. */
export async function verifiedBindings(instance, release) {
  const releaseDirectory = resolve(instance.releaseDirectory);
  ensure(await realpath(releaseDirectory) === releaseDirectory && releaseDirectory.endsWith(`/releases/${release.releaseHashHex}`), 'Invalid generated release directory');
  const filename = resolve(dirname(dirname(releaseDirectory)), 'bindings.mjs');
  ensure(await realpath(filename) === filename, 'Generated bindings may not traverse symlinks');
  const module = resolve(REPO, 'packages/policy-client/src/index.mjs');
  const expected = `// Generated local bindings. Package identity excludes this machine-specific import path.\nimport { PolicyOperationClient, PolicySession } from ${JSON.stringify(module)};\nexport const releaseHashHex=${JSON.stringify(release.releaseHashHex)};\nexport const stateFields=${JSON.stringify(release.package.stateFields)};\nexport async function connect(options){if(options.deployment.releaseHashHex!==releaseHashHex)throw Error('Selected deployment belongs to a different policy release');return PolicyOperationClient.connect(options);}\nexport async function connectSession(options){if(options.deployment.releaseHashHex!==releaseHashHex)throw Error('Selected deployment belongs to a different policy release');return PolicySession.connect(options);}\n`;
  const bytes = await readFile(filename, 'utf8');
  ensure(bytes === expected, 'Generated bindings changed or belong to another release; rebuild the selected package');
  // Import the verified bytes, avoiding a second file read between validation and execution.
  const source = bytes.replace(JSON.stringify(module), JSON.stringify(pathToFileURL(module).href));
  const bindings = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  ensure(bindings.releaseHashHex === instance.descriptor.releaseHashHex && canonicalHash(bindings.stateFields) === canonicalHash(instance.descriptor.stateFields), 'Generated binding identity mismatch');
  return bindings;
}

export async function verifyArtifacts(instance, release) {
  ensure(release.artifacts && Object.keys(release.artifacts).length === 8, 'Require both complete custom circuit artifact sets');
  for (const [name, artifact] of Object.entries(release.artifacts)) {
    ensure(/^runtime_policy_(init|evaluate)\.(arcis|idarc|hash|weight)$/.test(name), 'Unsupported policy artifact');
    const filename = resolve(instance.releaseDirectory, 'circuits', name);
    ensure(await realpath(filename) === filename, 'Policy artifact may not traverse symlinks');
    const bytes = await readFile(filename);
    ensure(sha256(bytes) === artifact.sha256 && bytes.length === artifact.bytes, 'Policy artifact differs from authenticated release');
  }
}

async function verifyLoadedPrograms(bootstrap, directory) {
  for (const deployment of bootstrap.loadedPrograms) {
    ensure(sha256(await readFile(deployment.local_elf_path)) === deployment.elf_sha256, 'Retained enforcement build changed');
    const output = resolve(directory, `loaded-${randomUUID()}.json`);
    await execute('python3', [resolve(REPO, 'scripts/verify_loaded_program.py'), '--program-id', deployment.program,
      '--elf', deployment.local_elf_path, '--rpc', bootstrap.endpoint, '--output', output], { maxBuffer: 1024 * 1024 });
    const report = JSON.parse(await readFile(output));
    ensure(report.matched === true && report.program === deployment.program && report.genesis_hash === bootstrap.genesisHash &&
      report.elf_sha256 === deployment.elf_sha256 && report.loaded_elf_sha256 === deployment.elf_sha256, 'Loaded custom program provenance mismatch');
  }
}

/** Product adapter over the generated public PolicySession API. No fixture fallback. */
export class ConsoleAdapter {
  static async connect({ instancePath, directory, administratorKeyfile, ownerKeyfiles = {} }) {
    const instance = await privateJson(instancePath);
    const results = await readDeploymentResults(instance.results);
    const releasePath = resolve(instance.releaseDirectory, 'release.json');
    ensure(await realpath(releasePath) === releasePath, 'Policy release may not traverse symlinks');
    const release = JSON.parse(await readFile(releasePath));
    ensure(release.schema === 1, 'Unsupported policy release manifest');
    const bootstrap = policyBootstrap(instance, results, release);
    const project = projectMetadata(bootstrap, { administratorKeyfile, ownerKeyfiles });
    await verifyArtifacts(instance, release);
    const bindings = await verifiedBindings(instance, release);
    for (const kind of ['merchant', 'license']) {
      ensure(typeof instance.assetDirectories?.[kind] === 'string' && instance.assetDirectories[kind].length > 0, 'Missing provisioned source directory');
      const path = resolve(instance.assetDirectories[kind]);
      ensure(path.startsWith(resolve(REPO, '.local') + sep) && await realpath(path) === path && (await stat(path)).isDirectory(), 'Missing local nonsymlink provisioned source directory');
    }
    const instanceDirectory = dirname(resolve(instancePath)), consoleDirectory = resolve(directory);
    ensure(consoleDirectory !== instanceDirectory && !consoleDirectory.startsWith(instanceDirectory + sep) &&
      !instanceDirectory.startsWith(consoleDirectory + sep), 'Use a separate console directory outside the deployment archive');
    directory = await sessionDirectory(directory);
    const operations = await sessionDirectory(resolve(directory, 'operations'));
    const provenance = await sessionDirectory(resolve(directory, 'provenance'));
    await verifyLoadedPrograms(bootstrap, provenance);
    const session = await bindings.connectSession({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot,
      endpoint: instance.endpoint, directory: resolve(directory, 'approvals'), idl: instance.idl, proofCli: instance.proofCli });
    project.slot = await session.connection.getSlot('confirmed');
    return new this({ instance, directory, operations, session, project, administratorKeyfile, ownerKeyfiles: { ...ownerKeyfiles } });
  }
  constructor(options) { Object.assign(this, options); }
  async refreshProject() {
    const slot = await this.session.connection.getSlot('confirmed');
    ensure(Number.isSafeInteger(slot) && slot >= 0, 'Invalid confirmed project slot');
    this.project.slot = slot;
    return this.project;
  }
  identity(op) {
    ensure(op && typeof op.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(op.id), 'Invalid operation identifier');
    ensure(op.sourceId === 'a' || op.sourceId === 'b', 'Invalid source wallet');
    ensure(decimal(op.amount, 48) > 0n, 'Amount must be positive');
    ensure(op.consumer && ['merchant', 'license'].includes(op.consumer.kind), 'Unsupported consumer');
    const consumer = op.consumer.kind === 'merchant' ? { kind: 'merchant', sku: op.consumer.sku }
      : { kind: 'license', productHex32: op.consumer.productHex32, expirySlot: op.consumer.expirySlot };
    if (consumer.kind === 'merchant') decimal(consumer.sku);
    else { ensure(/^[a-f0-9]{64}$/.test(consumer.productHex32), 'Invalid license product'); decimal(consumer.expirySlot); }
    return { id: op.id, amount: op.amount, sourceId: op.sourceId, consumer };
  }
  path(op) { this.identity(op); return resolve(this.operations, op.id); }
  intentPath(op) { this.identity(op); return resolve(this.operations, `${op.id}.intent.json`); }
  signers(op) {
    const ownerKeyfile = this.ownerKeyfiles[op.sourceId];
    if (!ownerKeyfile || !this.administratorKeyfile) throw failure('SIGNERS_REQUIRED', 'Configure this wallet owner and the administrator explicitly before approval.');
    return { ownerKeyfile, administratorKeyfile: this.administratorKeyfile };
  }
  async retainedIdentity(op) {
    const intent = await privateJson(this.intentPath(op));
    ensure(intent.schema === 1 && canonicalHash(intent.operation) === canonicalHash(this.identity(op)) &&
      intent.deploymentHash === descriptorDigest(this.instance.descriptor), 'Operation differs from retained console intent');
  }
  async assertRequestBinding(op, plan) {
    const d = plan.descriptor, { template } = validateOperation(d);
    ensure(plan.label === `console-${sha256(op.id).slice(0, 32)}`, 'Retained plan belongs to another console request');
    ensure(d.consumerKind === op.consumer.kind && (d.consumerKind === 'merchant' ? d.sku === op.consumer.sku :
      d.productHex32 === op.consumer.productHex32 && d.licenseExpirySlot === op.consumer.expirySlot), 'Plan consumer differs from console request');
    const directory = this.path(op);
    const request = await privateJson(resolve(directory, 'request.json'));
    const provisioned = await privateJson(resolve(this.instance.assetDirectories[op.sourceId === 'a' ? 'merchant' : 'license'], 'provisioned.json'));
    ensure(request.amount === Number(op.amount) && request.owner === d.owner && provisioned.source_owner === d.owner &&
      request.source === template.source && provisioned.accounts?.source?.address === template.source &&
      request.destination === template.destination && provisioned.accounts?.destination?.address === template.destination &&
      request.mint === template.mint && provisioned.accounts?.mint?.address === template.mint, 'Plan native source or amount differs from console request');
    // The SDK checked this local witness against the prepared native commitment when
    // creating the plan. Recheck that association without account decryption keys.
    const witness = await privateJson(resolve(directory, 'operation-witness.json'));
    ensure(witness.amount === Number(op.amount) && Array.isArray(witness.commitment) && witness.commitment.length === 32 &&
      witness.commitment.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) &&
      Buffer.from(witness.commitment).equals(Buffer.from(template.amountCommitment)), 'Plan amount commitment differs from retained native witness');
  }
  async plan(op, { inspect = false } = {}) {
    await this.retainedIdentity(op);
    const plan = await this.session.load(this.path(op));
    const planHash = descriptorDigest(plan.descriptor);
    ensure(inspect && op.planHash == null || typeof op.planHash === 'string' && op.planHash === planHash, 'Operation plan identity changed');
    await this.assertRequestBinding(op, plan);
    return plan;
  }
  async prepare(op) {
    const identity = this.identity(op), signers = this.signers(op);
    try { await writeNew(this.intentPath(op), JSON.stringify({ schema: 1, operation: identity, deploymentHash: descriptorDigest(this.instance.descriptor) })); }
    catch (error) { if (error.code === 'EEXIST') throw failure('PREPARATION_ALREADY_STARTED', 'Preparation already started. Inspect the retained operation; automatic preparation retry is disabled.'); throw error; }
    const parent = await open(this.operations, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    const plan = await this.session.prepare({ label: `console-${sha256(op.id).slice(0, 32)}`, directory: this.path(op),
      provisionedDirectory: this.instance.assetDirectories[op.sourceId === 'a' ? 'merchant' : 'license'], amount: Number(op.amount), consumer: identity.consumer }, signers);
    await this.assertRequestBinding(op, plan);
    const planHash = descriptorDigest(plan.descriptor);
    return { planHash, observation: await this.session.observe(plan) };
  }
  async inspect(op) {
    let plan;
    try { plan = await this.plan(op, { inspect: true }); }
    catch (error) { if (error.code === 'ENOENT') throw failure('PREPARATION_INCOMPLETE', 'No complete retained operation plan. Preparation may have performed local transactions; inspect the preserved artifacts before starting a separate request.'); throw error; }
    return { planHash: descriptorDigest(plan.descriptor), observation: await this.session.observe(plan) };
  }
  async observe(op) { return this.session.observe(await this.plan(op)); }
  async approve(op, role) {
    ensure(role === 'query' || role === 'commit', 'Unsupported approval role');
    const plan = await this.plan(op), signers = this.signers(op);
    if (role === 'query') await this.session.stageQuery(plan, signers);
    else await this.session.stageCommit(plan, signers);
    const { delivery, observation } = await this.session.submit(plan, role);
    return { delivery, observation };
  }
  async recover(op, role, submit = false) {
    ensure(role === 'query' || role === 'commit', 'Unsupported approval role');
    ensure(typeof submit === 'boolean', 'Explicit recovery submit flag required');
    const plan = await this.plan(op);
    const { delivery, observation } = await this.session[submit ? 'submit' : 'recover'](plan, role);
    return { delivery, observation };
  }
}
