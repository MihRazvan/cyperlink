// Explicit Node/local-validator entrypoint; the default SDK remains dependency-free and read-only.
export { LocalOperationClient, readOperationPlan, validateOperationPlan, descriptorDigest, queryStateDigest }
  from '../../local-client/src/index.mjs';
