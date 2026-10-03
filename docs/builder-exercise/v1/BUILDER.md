# Builder brief

Build a small application whose original private policy controls an exact native
confidential payment and grants a paid application effect. Write rules/state in your
own application directory, test/build/deploy through CyperLink, and use your generated
SDK bindings. Selecting a template or changing only its constants does not meet the
authoring criterion. Do not edit CyperLink core to complete the unaided exercise.

Before starting, record:

1. What would you build, for which user/workflow?
2. Which inputs, thresholds or state actually need confidentiality, and from whom?
   Policy source, account identities, timing and the disclosed decision are public.
3. How would you implement this today, or why would you leave it unbuilt?
4. What observable outcome would make this integration useful to you?

Evaluator and builder choose a bounded supported task and seal its requirements
before timing the run. If there is no supported real need, explicitly choose the
artificial fallback below. Its completion tests usability, not demand.

## Artificial fallback: rising-reserve procurement

Write a merchant purchasing policy with four private u64 fields, in this order:
`remaining`, `reserve_floor`, `purchases`, `reserve_step`. Let `n = purchases` be the
number of already committed purchases. Accept a positive authenticated amount `a`
only if `a <= remaining` and
`remaining - a >= reserve_floor + reserve_step * n`.
The reserve uses the counter **before** this purchase increments it. Success sets
remaining to `remaining - a`, increments purchases once, and preserves floor/step.
Denial preserves every predecessor field. Only atomic native settlement commits
this successor; a callback authorization does not spend capacity or grant access.

Use checked u64 arithmetic. Overflow in reserve multiplication/addition or the
successor counter, or subtraction underflow, must deny and preserve predecessor
state. Arithmetic failure anywhere in the expression graph denies even when a
branch is unselected; ordinary Rust `if` cannot inspect a private value. The
mandatory native amount bounds/commitment check must remain intact.

Every intended purchase has a unique buyer/SKU identity: merchant receipts are
one-time per owner and decimal u64 SKU. Record an immutable business purchase ID
mapped to that tuple. Recovery reuses the same intent/plan/signature. Honest fresh
recomputation after staleness uses a new explicitly approved operation, Job/permit
and nonce; it does not create a second fulfillment for an already-paid business ID.
An unpaid stale purchase may retain its SKU if its effect is still unissued. Do not
reuse an issued SKU to represent a different purchase or automatically pay again.

Author your tests and application. Cover boundaries, arithmetic failure and state
preservation as well as successful payments. Use [the compiler contract](../../compiler-gate.md)
and authoring guide for syntax/test format; use [the session API card](SESSION-API.md)
for lifecycle integration. No completed application is supplied as a solution.

Demonstrate: actual payment plus issued effect; denial despite sufficient native
funding; competing approvals with stale rejection; explicit fresh recomputation;
a compatible later purchase; and keyless process restart/recovery. Distinguish
host vectors, simulation, landed transactions and real local Arcium callbacks.
The evaluator handles controlled RPC faults and independent evidence checks.

## Present three separate facts

Your application must not collapse these into one success/failure flag:

- **Payment/effect:** unresolved, authorized, denied, stale or committed according
  to bound account observation. Authorization is not payment or a reservation.
- **Delivery:** retained signature and receipt availability/status. Missing receipt
  does not imply failed payment; committed accounts do not invent that receipt.
- **Current use:** a merchant effect is the one-time issued purchase record. If using
  the existing license option, `licenseActive` separately reflects its exact expiry.
  A historically committed but expired license gives no renewed access and does
  not authorize another charge. No renewal feature is part of this task.

Record questions, errors, documentation/source visits and assistance as they occur.
Stop and record a scoped unaided failure if completion requires a core patch or an
undocumented signer/journal workaround. A documented fix you implement in your own
application is ordinary development; supplied code or intervention-dependent repair
is assisted. Preserve the first result before any explicitly labeled continuation.
