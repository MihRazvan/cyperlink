# A private minimum reserve

The customer source keeps `remaining` and `reserve` as private u64 state. A
positive native payment is allowed only when its checked successor remains at
least the reserve. The reserve stays unchanged. No constant in public source
encodes its value, and neither field is disclosed by the deployed output schema.

This is an internal example authored by a separate agent using the documented
[authoring contract](../../../docs/compiler-gate.md) and package interface, after
the core authoring API existed. It is not external customer adoption. The author
added no core policy-name branch or alternate amount input.

Synthetic test-observer examples: initial `[100,50]` permits50 but denies60, even
though budget-only permits60. Changing the private reserve to30 permits60.
`tests.json` also covers native mismatch, underflow, zero, unused padding and
exact u64 bounds. These are host vectors; real distributed/native qualification
must be reported separately.

The initializer accepts the two values in the declared field order; use a private
local configuration file for actual deployment. The demo's printed initialization
values, if any, are test-observer disclosures, not decryption of MXE state.

The first package test ran all10 vectors through the shared CLI package API and
passed. The same API built both pinned ScalarField circuits in14.9 seconds on
this host, without changing the authoring library or adding policy-specific
platform code. This timing is local compilation, not MPC latency or Solana CU.
The schema digest is
`d56fd7c9c11ec1edd12bfe67b58823e8505cf34b6b1c8e703c65d9f25a43dd8d`.
Generated release files remain ignored and must be rebuilt if platform sources
change before deployment; the deployment evidence records the final release.
