import { resolve } from 'node:path';
import { canonicalHash } from '../../policy-client/src/deployment.mjs';
import { requireInput, validId } from './errors.mjs';

export function projectConfigHash(source) {
  return canonicalHash({ instancePath: resolve(source.instancePath), workspaceDirectory: resolve(source.workspaceDirectory) });
}

/** The project catalog may grow; each imported operation retains its exact
 * resolved plan and original approval journal independently of that catalog.
 */
export function operationSource(source, reference) {
  requireInput(validId(reference), 'Invalid configured operation reference.');
  if (source.operationSources !== undefined) {
    requireInput(Object.hasOwn(source.operationSources, reference), 'Operation reference is not configured.');
    const configured = source.operationSources[reference];
    return { directory: resolve(configured.directory), approvalsDirectory: resolve(configured.approvalsDirectory) };
  }
  return { directory: resolve(source.workspaceDirectory, 'operations', reference), approvalsDirectory: resolve(source.workspaceDirectory, 'approvals') };
}

export const operationConfigHash = (source, reference) => canonicalHash(operationSource(source, reference));
