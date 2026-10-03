# Docs-first authoring friction

This is an internal application authored by a separate agent, not independent
customer validation. The first implementation used the authoring guide, compiler
contract, policy-client README and declarations, and local-client operation guide.
No qualification harness or other application implementation was read or copied.

1. `stageQuery(plan, {owner})` has no administrator argument. The connection's
   `payerKeyfile` is the administrator. To confirm this security-sensitive mapping,
   I inspected `packages/policy-client/src/operation-client.mjs` (`connect`,
   `assertDeploymentState`, `prepare`). All mutation commands therefore require
   an explicit `--admin-keyfile`; no bootstrap signer path is adopted silently.
2. `prepare` itself loads and uses `provisionedDirectory/source-owner-signer.json`;
   the declared prepare options have no owner argument. This was confirmed in the
   same source inspection. The application requires an explicit `--owner-keyfile`
   pointing to that exact file for preparation and verifies its public key against
   the retained owner for subsequent approval commands.
3. The docs show create-only `createPrivateRun` but do not explain reconnecting
   session directories. I inspected that helper and `LocalSession` in
   `packages/local-client/src/runtime.mjs`: session sequence numbers restart at
   zero, so reusing a signing session risks create-only output collisions. Every
   invocation uses a fresh private session while `client.load` reopens the retained
   operation and old tickets retain their original durable journal paths.
4. Signer-free observation/recovery is documented as a separate worker, rather
   than generated `connect` (which always loads a payer). The application delegates
   only those commands to `packages/policy-client/recover-operation.mjs`. I read
   its option parser/output format to consume its public observation/delivery
   envelope. This was SDK support inspection, not qualification-harness reuse.
5. Staging journals signed bytes before returning a ticket, but the documented API
   exposes no ticket rediscovery after a process dies between staging and saving
   the returned ticket. A create-only approval intent blocks accidental restaging
   in that window. Keep all files and inspect the original journal; this app does
   not claim arbitrary interruption recovery. Completed saved tickets do reopen
   across fresh application processes and can be reconciled or explicitly resent.
6. License expiry is an absolute slot and must be within the consumer's supported
   1000-slot window at commit. The app requires the explicit exact expiry; it does
   not silently renew a signed action or replace an expired operation.
7. Root review identified a bug in the first restart implementation: calling
   `client.submit` on an old saved ticket through a fresh session selects the new
   session's journal and rejects with `Ticket does not match journal`. Root
   supplied this diagnosis; this is assisted internal authoring, not an unaided
   customer result. Existing-ticket approvals now perform the explicit signer,
   consumer and deployment checks, then invoke the documented keyless
   `submit-ticket` worker, which opens the ticket's original journal. They never
   copy the journal, restage the operation or change the signed bytes. Root's live
   qualification exercises stage-without-submit followed by approval in a new
   process; the host CLI tests alone do not establish restart execution.
