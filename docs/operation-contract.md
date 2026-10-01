# Operation contract and initial lifecycle SDK

CyperLink authorizes one exact native confidential payment and one application effect against one version of private shared state. The initial SDK in `packages/sdk` reads and reconciles that operation on a local validator. It is an implementation of the observation/recovery part of the developer contract; provisioning, transaction construction, signing and production wallet integration remain separate work.

The operation proceeds through these explicit steps:

1. A client retains reusable account decryption keys locally, constructs native proofs and the exact merchant or license action, and prepares its immutable action bytes.
2. The owner and administrator authorize a specific query. The request binds the native action, consumer/effect, quota version, encrypted inputs, computation, expiry and unique permit. A private allow/deny result can become public even if the owner never commits.
3. The authenticated computation callback can admit the permit. It does not transfer funds, reserve quota or issue a paid entitlement.
4. The owner signs the selected consumer commit. The native transfer, quota compare-and-swap, permit consumption and entitlement execute atomically. The current quota and native account state are checked again.
5. A client reconciles committed account effects before reporting success. Expiry, cancellation, stale state, denial or a lost transaction response require explicit recovery decisions.

A retry of an identical signed transaction is distinct from a fresh private query. Fresh computation needs owner and administrator authorization, a fresh Job/permit, and a nonrecycled nonce. The SDK never signs, automatically renews, searches thresholds or recomputes a denied/stale request.

## Retained operation descriptor

An `Operation` is a JSON-compatible client record containing:

| Field | Contract |
|---|---|
| `profile` | Exactly `local-native-ct-v0` |
| `job`, `computation`, `permit` | The expected immutable operation addresses |
| `owner`, `admin`, `quota` | The intended source owner, policy administrator and configured quota |
| `consumerKind` | `merchant` (also the default when omitted) or `license`; arbitrary adapters are not accepted |
| `effect` | Expected paid consumer entitlement address |
| `sku` | Merchant only: decimal u64 SKU |
| `productHex32`, `licenseExpirySlot` | License only: 32-byte product identifier as 64 hex characters, and decimal u64 expiry slot |
| `templateHex` | Exact 520-byte queued Job template, including selected native accounts, native/prestate hashes, commitment, consumer/action digest, quota predecessor, successor nonce and expiry |
| `inputsHashHex` | Expected SHA256 of the encrypted computation input binding |

Retain this record from the authorized request. Do not manufacture expectations by copying an untrusted account response and then claim that comparing the same response authenticates user intent. The SDK validates the selected consumer semantic digest against the retained owner, destination, mint and exact effect address. Merchant binding includes the SKU; license binding includes the exact product identifier and license expiry slot. The reviewed consumer adapters are internal and fixed to their program IDs; a caller cannot replace an effect decoder or bypass a binding check. It verifies that the observed Job, permit and effect match this record. Address derivation and construction of the authorized request currently belong to the transaction-building client; this reader does not derive PDAs or verify a historical transaction signature.

The descriptor contains public identifiers, hashes and ciphertext-related fields. It must contain no reusable ElGamal/AES account secrets or plaintext private policy state. Keeping the descriptor allows recovery after interrupted submission without replaying a private query.

## Usage

There are no third-party JavaScript dependencies or install step for this package. It uses Node's standard SHA256 implementation, strict account codecs and an injected read transport.

```js
import { readFile } from 'node:fs/promises';
import { LocalRpcTransport, OperationReader } from './packages/sdk/src/index.mjs';

const operation = JSON.parse(await readFile('.local/my-operation.json', 'utf8'));
const reader = new OperationReader(new LocalRpcTransport('http://127.0.0.1:8899'));
const observation = await reader.observe(operation);
console.log(observation.status, observation.actions);
```

The default adapter uses one `getMultipleAccounts` read for Job, permit, quota and the selected consumer entitlement, with one context slot and `finalized` commitment. `confirmed` can be chosen explicitly and remains visible in the returned observation; it has weaker rollback assurance. Public endpoints, authenticated URLs and HTTP redirects are rejected. Repeated reads use `minContextSlot` and reject a regressing response. A transport can be injected for testing; injected snapshots are test evidence, not validator or distributed execution.

## Supported account layouts

The current implementation profile uses a 1024-byte Anchor Job allocation (682 serialized bytes plus zero padding), 520-byte H permit, **161-byte H quota**, and either a 49-byte merchant entitlement or an 81-byte license entitlement. The license layout is `LICENSE1` (8 bytes), owner (32), product (32), expiry slot (8 little-endian) and issued flag (1). Its exact semantic digest is `SHA256("licensed-product-v1" || effect || product || expiryLE || owner || destination || mint)`. The quota retains the historical 129-byte prefix and adds a 32-byte transient active-permit route at offset 129. The reader requires this route to be zero outside atomic settlement. Historical 129-byte quotas are rejected rather than silently interpreted as the current profile.

The codecs validate program owners, executable flags, exact lengths, Job discriminator, supported states, zero padding, ciphertext hashes and binding fields. They trust the configured on-chain programs and local RPC to enforce owner signatures and authenticated callback admission. Reading a program-owned Job is not independent cryptographic verification of all historical signatures, and this package is not a light client.

## Status and recovery

| Status | Evidence and permitted next step |
|---|---|
| `unobserved` | No Job at this commitment, empty permit and no entitlement; keep observing. This does not prove a submitted transaction failed. |
| `queued` | Pending bound Job and empty permit; observe or request owner-signed cancellation. |
| `authorized` | Admitted Job and exact-bound authenticated permit, current predecessor and unexpired slot; owner may submit commit. Settlement can still fail if native state changes. |
| `stale` | Quota advanced past this unconsumed request; owner may cancel and explicitly authorize a fresh request. |
| `expired` | Observed slot exceeds authorization expiry, or an uncommitted license reaches its license expiry slot; owner may cancel and explicitly authorize a fresh request. |
| `denied` | Authenticated Job reports denial and permit is empty; a new query needs fresh owner/admin authorization. No private reason is inferred. |
| `invalidated` | Callback recorded an expired or stale request without admitting a permit; new query authorization is required. |
| `cancelled` | Job and permit agree on cancellation; any replacement needs fresh authorization. |
| `committed` | Exact-bound permit consumed, matching paid entitlement issued, and quota advanced, all observed in one snapshot. |

`actions` describe allowed recovery choices; they do not execute them. A returned authorization never guarantees future settlement. A denial does not prove insufficient budget because the circuit also gates results on the native amount commitment.

The Job remains admitted after a successful consumer commit; its status alone cannot indicate payment. A transaction signature or callback notification alone is likewise insufficient. When quota is exactly one version ahead, the SDK verifies the complete authorized successor ciphertext/nonce/hash. If subsequent purchases have advanced it further, consumed permit plus exact paid consumer entitlement still establish this operation's completion under the trusted atomic consumer/program invariants.

Conflicting ownership/bindings, partial paid effects, malformed layouts, a persisted armed permit, a persisted transient route, or quota regression raise `EvidenceError`. The SDK refuses to guess a recoverable business status from contradictory evidence. Investigate the snapshot and loaded program versions before performing recovery.

## Verification and limits

Run `node --test packages/sdk/test/lifecycle.test.mjs`. Tests cover callback-versus-commit distinction, complete and partial atomic effects, exact successor validation, later quota advancement, stale/expired recovery, denial/invalidation/cancellation, owner/address/input/action mismatches, schema boundaries, idle route enforcement and consistent loopback RPC reads, and license-specific forged owner/product/expiry/consumer/record rejection. A committed license remains a committed payment after its lifetime ends; observations separately expose `licenseActive` and `licenseExpirySlot`. An uncommitted authorization for an expired license is reported as `expired`, even when its permit has a later expiry.

These are host tests using explicitly synthesized account bytes. They do not demonstrate distributed computation, genuine signatures, native proof verification or loaded ELF identity. Current live qualification and its evidence belong in `STATUS.md`. The reader includes the merchant and expiring-license consumer adapters. Both are covered by host tests; the presence of either adapter does not establish that its current live joined path has completed. Consult the separately recorded validator/distributed demo evidence in `STATUS.md`. This is an initial local SDK surface, not a production security or external integration claim.


A license descriptor uses the same retained Job/permit/input binding fields as a merchant descriptor:

```js
const operation = {
  ...authorizedCommonFields,
  consumerKind: 'license',
  productHex32: authorizedProductBytes.toString('hex'),
  licenseExpirySlot: authorizedLicenseExpiry.toString(),
};
const observation = await reader.observe(operation);
// status answers whether this payment committed; licenseActive answers current use.
```

`authorizedCommonFields` must come from the locally authorized request, including the exact queued template and locally computed encrypted-input hash. Fetching a Job and using its bytes as the expected authorization would only compare the account with itself. These host-tested consumer adapters intentionally provide no such constructor from received Job data.

## Constructing exact action bindings

The SDK exports `buildMerchantDigest`, `buildLicenseDigest` and `buildActionTemplate` so integrations do not need to copy the example's byte assembly. The semantic digest builders are also used internally by the operation observer, keeping construction and verification on the same contract.

```js
import { buildMerchantDigest, buildActionTemplate, publicKeyBytes } from './packages/sdk/src/index.mjs';

const digest = buildMerchantDigest({
  effect: publicKeyBytes(entitlementAddress),
  sku: 7n,
  owner: publicKeyBytes(ownerAddress),
  destination: publicKeyBytes(destinationAddress),
  mint: publicKeyBytes(mintAddress),
});
const immutableAction = buildActionTemplate({
  source, mint, destination, owner, quota, consumer, // each: 32-byte public key
  sourceData, nativeData,                         // complete current source and exact instruction bytes
  proofKeys: [equalityKey, groupedKey, rangeKey],  // each: 32-byte public key
  proofData: [equalityContext, groupedContext, rangeContext], // complete native-verified context account bytes
  newSource,                                    // 64-byte new source ciphertext
  commitment,                                   // 32-byte native amount commitment
  consumerContract: digest,                      // 32-byte semantic digest
});
```

All byte arguments accept `Uint8Array`, including Node `Buffer`; they do not accept base58 or hex strings implicitly. `publicKeyBytes` explicitly converts base58 addresses. Integer arguments use `bigint` or canonical decimal strings, never JavaScript numbers. `buildLicenseDigest` replaces `sku` with a 32-byte `product` and u64 `expirySlot`. These names describe binary builder arguments; the persisted license descriptor separately uses `productHex32` and `licenseExpirySlot`.

`buildActionTemplate` returns the exact **464-byte immutable prepare-action input** with its first 80 bytes zero. This is distinct from the **520-byte queued Job template** in `Operation.templateHex`: the authorized queue binds quota predecessor, unique nonce and expiry, while only the authenticated callback supplies the encrypted successor. The builder hashes the complete native instruction, selected native/proof account identities, owner and full proof-context account contents in the on-chain order. It copies caller buffers rather than retaining mutable references.

These are deterministic encoders, not proof verifiers or signing tools. Supplying arbitrary context bytes to the builder cannot make them native-verified; native proof verification and the queue's full admission validation remain mandatory. The builder neither submits transactions nor reveals policy decisions, allocates nonces, admits permits or automatically requests a new query. Three additional host test groups preserve independently captured example digest/template vectors and reject wrong lengths, reordered/mutated bindings and ambiguous integer representations. Run all SDK tests with `node --test packages/sdk/test/*.test.mjs`.
