# SDK lifecycle milestone

Started 2026-10-02. Initial profile remains synthetic local no-fee Token-2022, one quota/MXE and explicit owner/admin-authorized queries. This milestone turns the proven joined demo into reusable preparation, signing, submission, observation and recovery APIs.

1. Bind each signed query to the exact quota predecessor **and nonce allocation counter**. The old instruction selected them at execution; delayed signed requests could therefore diverge from the client's retained descriptor. New `expected_query_state` checks a domain-separated digest before MPC queueing. Rebuild Auth/IDL and verify actual loaded ELF before live claims.
2. Persist the exact intended operation and fully signed transaction before broadcast. Store no reusable account keys in public descriptors/journals. Persist bounded broadcast attempts; restart recovery reconciles existing signatures and may resend identical signed bytes only. It never refreshes blockhashes, allocates a new nonce or obtains another policy decision implicitly.
3. Extract native proof preparation, consumer initialization, exact query/commit builders and explicit signing into the local SDK entrypoint. Keep the dependency-free observation API available. Fixed merchant/license semantics and owner signing remain enforced.
4. Exercise separate Node-process recovery before query send, after a lost send response, after callback and after settlement. Run both real local-validator/two-node scenarios with fresh identities; reject stale signed queries without Job/permit claim/computation creation or quota change. Retain receipts, snapshots, actual ELF checks and source manifests.

The first boundary is recovery of a fully retained operation, after proof/action preparation. An interrupted earlier native provisioning/proof upload still requires explicit inspection; this milestone does not promise arbitrary provisioning resume, cleanup or wallet/KMS integration. Signed ticket metadata is not sufficient authentication: recovery must compare the retained operation's exact instruction with the signed message.

A later interactive demo can consume these same APIs. Blank-machine/compiler-cache qualification remains a separate open task. Original research and all prior ledgers remain preserved.
