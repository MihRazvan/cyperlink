import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConsoleAdapter } from '../../../apps/console/adapter.mjs';
import { descriptorDigest } from '../../policy-client/src/operation-plan.mjs';
import { PolicySession } from '../../policy-client/src/policy-session.mjs';
import { requireInput, validId } from './errors.mjs';
import { operationSource } from './config.mjs';

// This factory reuses the existing release, generated-binding, circuit and loaded
// ELF checks. No signer options enter this boundary. Preparation stays client-side.
export async function connectLocalBackend({ instancePath, workspaceDirectory, operationSources }) {
  const adapter = await ConsoleAdapter.connect({ instancePath, directory: workspaceDirectory });
  const sessions = new Map();
  async function load(reference, expectedHash) {
    requireInput(validId(reference), 'Invalid configured operation reference.');
    const configured = operationSource({ workspaceDirectory, operationSources }, reference);
    const directory = configured.directory;
    requireInput(await realpath(directory) === directory, 'Operation reference traverses a symbolic link.');
    let session = adapter.session;
    if (configured.approvalsDirectory !== resolve(workspaceDirectory, 'approvals')) {
      if (!sessions.has(reference)) {
        const instance = adapter.instance;
        sessions.set(reference, await PolicySession.connect({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot,
          endpoint: instance.endpoint, directory: resolve(configured.approvalsDirectory), idl: instance.idl, proofCli: instance.proofCli }));
      }
      session = sessions.get(reference);
    }
    const plan = await session.load(directory);
    const hash = descriptorDigest(plan.descriptor);
    requireInput(expectedHash === undefined || expectedHash === hash, 'Retained operation identity changed.');
    return { plan, hash, session };
  }
  return Object.freeze({
    project: Object.freeze({ name: adapter.project.name, release: adapter.project.release, profile: adapter.project.profile,
      genesis: adapter.project.genesis, deploymentHash: adapter.project.deploymentHash, network: 'local' }),
    async inspect(reference) {
      const { plan, hash } = await load(reference);
      return { planHash: hash, consumerKind: plan.descriptor.consumerKind, contextSlot: plan.contextSlot };
    },
    async observe(reference, hash, minimumSlot) {
      const { plan, session } = await load(reference, hash);
      session.reader.minimumSlot = Math.max(session.reader.minimumSlot ?? 0, minimumSlot);
      return { observation: await session.observe(plan) };
    },
    async recover(reference, hash, minimumSlot, role) {
      const { plan, session } = await load(reference, hash);
      session.reader.minimumSlot = Math.max(session.reader.minimumSlot ?? 0, minimumSlot);
      const { delivery, observation } = await session.recover(plan, role);
      // Deliberately omit the SDK ticket, local journal paths and signed bytes.
      return { delivery, observation };
    },
  });
}
