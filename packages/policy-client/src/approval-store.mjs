import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, mkdir, realpath, readdir, link, unlink } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO, ensure, loopbackEndpoint } from '../../local-client/src/runtime.mjs';
import { DurableTransactionSender } from '../../local-client/src/durable-transaction.mjs';
import { publicKeyBytes } from '../../sdk/src/index.mjs';
import { descriptorDigest, validateOperationPlan } from './operation-plan.mjs';
import { validateOperationTicket } from './operation-ticket.mjs';

const local = resolve(REPO, '.local');
const hex32 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const failure = (code, message) => Object.assign(Error(message), { code });
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function checkedDirectory(path) {
  ensure((path === local || path.startsWith(local + sep)) && await realpath(path) === path, 'Approval directory must be beneath repository .local without symlinks');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    ensure(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'Approval directory must be private and owned by this user');
  } finally { await handle.close(); }
}
async function createDirectory(path) {
  ensure(path.startsWith(local + sep), 'Approval directory must be beneath repository .local');
  await checkedDirectory(local);
  let current = local;
  for (const segment of path.slice(local.length + 1).split(sep)) {
    await checkedDirectory(current);
    const child = resolve(current, segment);
    try { await mkdir(child, { mode: 0o700 }); await syncDirectory(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await checkedDirectory(child); current = child;
  }
}
async function readJSON(path) {
  await checkedDirectory(dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    ensure(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.size <= 4 * 1024 * 1024, 'Approval record must be a private bounded regular file');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function publish(path, value) {
  await checkedDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await link(temporary, path); await syncDirectory(dirname(path)); return true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
  finally { await unlink(temporary); await syncDirectory(dirname(path)); }
}

/** Create-only approval intents reserve a single signing attempt, even across process crashes.
 * This store never signs, simulates, submits, or authorizes a replacement transaction.
 */
export async function openApprovalStore({ directory, genesisHash, endpoint, deploymentHash }) {
  publicKeyBytes(genesisHash); ensure(hex32(deploymentHash), 'Invalid approval deployment hash');
  const root = resolve(directory), normalized = loopbackEndpoint(endpoint);
  await createDirectory(root);
  const manifest = { schemaVersion: 1, genesisHash, endpoint: normalized, deploymentHash };
  const manifestPath = resolve(root, 'approval-store.json');
  await publish(manifestPath, manifest);
  assert.deepEqual(await readJSON(manifestPath), manifest, 'Approval store deployment/ledger/endpoint mismatch');

  function slot(plan, role) {
    validateOperationPlan(plan);
    ensure(['query', 'commit'].includes(role), 'Unsupported approval role');
    ensure(plan.genesisHash === genesisHash && descriptorDigest(plan.descriptor.deployment) === deploymentHash, 'Approval plan deployment/ledger mismatch');
    const descriptorSha256 = descriptorDigest(plan.descriptor), directory = resolve(root, `${descriptorSha256}-${role}`);
    const signingDirectory = resolve(directory, 'signing'), journalDirectory = resolve(signingDirectory, 'transaction-journal');
    const intent = { schemaVersion: 1, descriptorSha256, role, profile: plan.descriptor.profile, genesisHash, endpoint: normalized,
      deploymentHash, owner: plan.descriptor.owner, admin: plan.descriptor.admin, directory, signingDirectory, journalDirectory };
    return { intent, directory, signingDirectory, journalDirectory };
  }
  async function readIntent(plan, role) {
    await checkedDirectory(root);
    assert.deepEqual(await readJSON(manifestPath), manifest, 'Approval store manifest changed');
    const result = slot(plan, role);
    assert.deepEqual(await readJSON(resolve(result.directory, 'intent.json')), result.intent, 'Approval intent differs from retained operation');
    await checkedDirectory(result.signingDirectory);
    return result;
  }
  function canonicalTicket(ticket, intent) {
    ensure(ticket?.schemaVersion === 1 && ticket.journalDirectory === intent.journalDirectory && ticket.genesisHash === genesisHash
      && ticket.role === intent.role && ticket.descriptorSha256 === intent.descriptorSha256
      && signaturePattern.test(ticket.signature) && hex32(ticket.wireSha256), 'Approval ticket differs from intent');
    return { schemaVersion: 1, journalDirectory: intent.journalDirectory, genesisHash, signature: ticket.signature,
      wireSha256: ticket.wireSha256, role: intent.role, descriptorSha256: intent.descriptorSha256 };
  }
  const store = {
    directory: root,
    ticketPath(plan, role) { return resolve(slot(plan, role).directory, 'ticket.json'); },
    async begin(plan, role) {
      await checkedDirectory(root);
      assert.deepEqual(await readJSON(manifestPath), manifest, 'Approval store manifest changed');
      const result = slot(plan, role);
      await createDirectory(result.signingDirectory);
      const path = resolve(result.directory, 'intent.json'), created = await publish(path, result.intent);
      assert.deepEqual(await readJSON(path), result.intent, 'Approval intent differs from retained operation');
      return { created, ...result };
    },
    async saveTicket(plan, role, ticket) {
      const { intent } = await readIntent(plan, role), value = canonicalTicket(ticket, intent), path = store.ticketPath(plan, role);
      await publish(path, value);
      assert.deepEqual(await readJSON(path), value, 'Approval ticket already contains a different signed transaction');
      return value;
    },
    async discover(plan, role, { web3, connection }) {
      const { intent, journalDirectory } = await readIntent(plan, role);
      const interrupted = () => failure('APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD', 'Approval interrupted before a signed operation record; automatic restaging is forbidden');
      let names;
      try { await checkedDirectory(journalDirectory); names = await readdir(journalDirectory); }
      catch (error) { if (error.code === 'ENOENT') throw interrupted(); throw error; }
      ensure(names.length <= 4096, 'Approval journal exceeds bounded discovery limit');
      if (!names.some(name => name.endsWith('.signed.json'))) throw interrupted();
      const sender = await DurableTransactionSender.open({ web3, connection, endpoint: normalized, directory: journalDirectory });
      ensure(sender.manifest.genesisHash === genesisHash, 'Approval journal belongs to another ledger');
      const candidates = [];
      for (const name of names.filter(name => name.endsWith('.signed.json'))) {
        ensure(signaturePattern.test(name.slice(0, -'.signed.json'.length)), 'Malformed signed journal filename');
        const record = await readJSON(resolve(journalDirectory, name));
        // ALT setup has no operation descriptor. A purported operation in this dedicated
        // journal must match both fields; it cannot be hidden as unrelated metadata.
        if (record.descriptorSha256 == null && !['query', 'commit'].includes(record.role)) {
          ensure(record.category === 'lookup-table' && ['create-demo-alt', 'extend-demo-alt'].includes(record.role), 'Unrelated signed record in approval journal');
          const generic = { schemaVersion: 1, journalDirectory, genesisHash, signature: name.slice(0, -'.signed.json'.length),
            wireSha256: record.wireSha256, role: record.role, descriptorSha256: null };
          const saved = await sender.read(generic);
          ensure(saved.tx.message.addressTableLookups.length === 0, 'ALT setup cannot use unresolved address tables');
          const instructions = web3.TransactionMessage.decompile(saved.tx.message).instructions;
          ensure(instructions.length === 2 && instructions[0].programId.equals(web3.ComputeBudgetProgram.programId)
            && instructions[1].programId.equals(web3.AddressLookupTableProgram.programId), 'Generic record is not ALT setup');
          ensure(web3.AddressLookupTableInstruction.decodeInstructionType(instructions[1]) === (record.role === 'create-demo-alt' ? 'CreateLookupTable' : 'ExtendLookupTable'), 'Generic ALT instruction differs from role');
          continue;
        }
        const ticket = canonicalTicket({ ...record, journalDirectory }, intent);
        ensure(name === `${ticket.signature}.signed.json`, 'Signed approval filename differs from signature');
        candidates.push(ticket);
      }
      if (!candidates.length) throw interrupted();
      if (candidates.length !== 1) throw failure('APPROVAL_AMBIGUOUS', 'Multiple signed approval candidates; refusing to choose or restage');
      const ticket = candidates[0];
      const saved = await sender.read(ticket);
      await validateOperationTicket(plan, saved.record, web3, connection);
      // Simulation may be absent after a crash. Preserve the ticket so recovery can
      // explicitly report simulation-required; discovery is never implicit approval.
      return store.saveTicket(plan, role, ticket);
    },
  };
  return store;
}
