# Custom policy compiler contract v1

The bounded implementation uses typed Rust expressions over pinned
`arcis-compiler =0.15.0` ScalarField internals. High-level Arcis has a different
BaseField/RescueCipher domain (255-bit declarations), while the authenticated
native bridge uses ScalarField/CSplRescueCipher (253-bit declarations). Running
`node tests/cipher-domains.mjs .local/toolchain/js`
again confirms both own-domain round trips and rejects treating scalar ciphertext
as high-level input. Equal 32-byte encodings are not a conversion. The pinned
high-level API has no supported native Pedersen bridge or same-secret conversion
identified in this bounded source inspection. This is not proof one cannot be
implemented; a compiler fork is outside the supported profile. We do not join separately
successful circuits, narrow native openings or introduce another amount.

## Author contract

Customer Cargo code depends on `cyperlink-policy-authoring =0.1.0` by a local
tooling-provided path. A policy declares one to four uniquely named private u64
fields, ordered as its schema. The source exports a function with this signature:

```rust
use cyperlink_policy_authoring::{Context, Payment, State, Decision};
pub const FIELDS: &[&str] = &["remaining", "purchases"];
pub fn policy(ctx: &mut Context, payment: Payment, state: &State) -> Decision {
    let amount = payment.amount();
    let remaining = state.get("remaining");
    let purchases = state.get("purchases");
    let allow = amount.gt(ctx.constant(0))
        .and(amount.le(remaining)).and(purchases.lt(ctx.constant(5)));
    let next_remaining = ctx.sub(remaining, amount);
    let next_count = ctx.add(purchases, ctx.constant(1));
    ctx.finish(allow, &[next_remaining, next_count])
}
```

The CLI-generated build executable calls
`cyperlink_policy_authoring::build(FIELDS, policy, output_directory)`.
No absolute source path or policy name selects core behavior. The fixed wrapper
authenticates the *same* decrypted amount used by the author through all32 bytes
of the native SDK7 Pedersen commitment, with the full ScalarField opening and a
mandatory amount below2^48 check. Customer code cannot emit a separate public
value, choose token accounts or override native validity using this API.

Expressions support u64 constants; eq/gt/ge/lt/le; Boolean and/or/not; private
Boolean `select(yes,no)`; checked `ctx.add/sub/mul`; and fixed ordered successor
records. All arithmetic is fail-closed, including unselected expression branches.
There is no division, variable private loop, dynamic state, private Rust `if`,
extra private input, time oracle or external fact adapter. Ordinary Rust can
compose fixed public loops/helpers when constructing expressions. A public
constant in source is not a confidential threshold; put confidential thresholds
in private state. Compilation does not certify arbitrary policy privacy.

`host_ir(FIELDS, policy)` is a deliberately named test-only IR constructor that
exposes synthetic state. It is never the deployed wrapper. Cargo is trusted
local code execution, not a hosted malicious-code sandbox.

The ergonomic test entrypoint is `test_vectors(FIELDS, policy, json_path)`,
returning a JSON host-evidence report. Its file is an array of
`{name, amount, state: [...], allow: true|false, next: [...]}` records, with
integer values encoded as unsigned numbers or decimal strings. State arrays
match the declared field order; optional four-slot arrays test padding. Optional
`native_amount` and `corrupt_commitment_byte` exercise binding failures. These
synthetic tests never send transactions. Actual compiler/host qualification and
results are retained in [the gate evidence](../evidence/2026-10-02/compiler-gate.json).
Reproduce the maintained host/compiler checks without deploying:

```sh
CARGO_TARGET_DIR=.local/circuit-build-target cargo test --locked --offline \
  --manifest-path crates/policy-authoring/Cargo.toml
```

Explicit artifact tests `compile_artifacts` and `compile_artifact_variants` additionally
require `CYPERLINK_POLICY_BUILD_OUT` set to a fresh ignored output and `-- --ignored`.
Compiler weights are modeled ACUs, separate from Solana CU and runtime latency.

## Fixed wire interface

Both interfaces use only client ephemeral X25519 public keys; no reusable wallet
key or MXE secret enters the compiler inputs. Four state slots are always encrypted
together. Unused slots must be zero; initializer and evaluator enforce that.

| Circuit | Input order | Public output shape |
| --- | --- | --- |
| `runtime_policy_init` | client key, client nonce u128, initial `[ciphertext253;4]`, MXE successor nonce u128 | validity bool, `[ciphertext253;4]` |
| `runtime_policy_evaluate` | client key, client nonce u128, amount ciphertext, full opening ciphertext, old state nonce u128, old `[ciphertext253;4]`, successor nonce u128, authenticated commitment `[u8;32]` | reconstructed commitment `[u8;32]`, allow bool, `[ciphertext253;4]` |

Flattened input/output counts are7/5 and42/37. Initializer invalid state returns
false and encrypted zeros; admission must reject false. Evaluation denial
preserves all four plaintext predecessor slots in the encrypted successor.
Both old and next declared fields must fit u64. No state authority, nonce
uniqueness, release identity, callback authentication or native settlement is
established by compilation alone; those belong to deployment/admission/settlement.
Runtime qualification is tracked separately in STATUS.
