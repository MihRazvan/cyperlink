# Custom-policy-v1 enforcement

These maintained deployment sources are a separate ABI from the reviewed v0
programs. They share upstream native admission, hook metadata and PDA creation
libraries, while preserving v0 source, addresses, artifacts and historical reads.
The source copies are deliberately maintained separately: changes here must be
qualified on newly built and actually loaded programs.

`stage.py --config deployment-bytes.json --out .local/NAME --circuits BUILD`
generates a fresh workspace. Config fields `auth`, `policy`, `guard`, `quota`,
`merchant`, `license`, `release`, `schema`, `domain` are32-byte integer arrays.
The caller derives `quota` from `["quota"]` and the generated policy address.
`guard` is also the settlement kernel; the operation interface is a library,
not a sixth deployed program. A distinct Auth address owns its distinct MXE.
The stage command neither deploys nor signs. Its output includes configured
sources and the two exact supplied circuit artifacts/interfaces.

The353-byte state preserves offsets0–160, including the native hook's active
permit pointer at129. Ciphertext0 stays at56; ciphertexts1–3 occupy161–256.
Release, schema and key-domain identities occupy257–352. The712-byte permit
preserves its520-byte prefix, adds ciphertexts1–3 at520 and identity at616.
Every field is fixed-size. No variable payload shifts the u8 hook lookup index.

The state hash is SHA256(`cyperlink-private-state-v1` || identity96 || nonce16 ||
all four ciphertexts128). The signed-query digest is SHA256(
`cyperlink-policy-query-v1` || all353 state bytes), including the separate nonce
counter, administrator and idle route. Settlement compare-and-swap checks
version and full state hash; hook consumption advances all ciphertexts together.
Callbacks only populate permits. Native CPI, complete state consumption and exact
merchant/license effects remain one transaction. All native proof/account/funding
validation runs before queue and again at settlement.

Deployment order is programs → owner-authorized quota provisioning → administrator
computation-definition registration/upload → encrypted initialization. Definition
registration, initialization and each policy query require the state administrator.
Each query additionally requires the native source owner; final settlement still
requires its exact owner signature. The fixed program ID, MXE and definition PDAs
authenticate callbacks; the immutable Job binds each computation and permit.
Identity checks reject a different release/schema/domain even when ciphertext
and legacy routing bytes otherwise look valid. Empty permits may be cancelled
before admission without ever acquiring business authority.

Arcium's onchain-circuit definition contains completion/upload authority, not a
circuit digest available to these handlers. Deployment tooling must verify the
uploaded bytes and generated interface against the release. Onchain checks bind
the compiled release, deployment addresses, exact definition and owning MXE;
they do not turn an upgradeable program into immutable code. The state owner
trusts its authorized deployment and program upgrade authority. There is no
release replacement, migration, disablement or state reset endpoint. Use a fresh
release and state domain; pending operations retain their original deployment.

Initial private outputs are `(valid, [ciphertext;4])`; evaluation outputs are
`(native_commitment32, allow, [ciphertext;4])`. Invalid initialization completes
its Job as denied without writing business state. Authenticated denied evaluation
likewise preserves capacity. Output disclosure remains a public Boolean and
encrypted successor, not a policy privacy certification.
