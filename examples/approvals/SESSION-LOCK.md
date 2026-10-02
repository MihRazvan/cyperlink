# One server per local session

The Approvals server acquires `.server.lock` in its private session directory before opening the real adapter, inspecting retained operation state or accepting HTTP requests. A second server using that directory fails closed, even on another HTTP port. The mode0600 record contains only the process ID, a unique instance ID and start time; it contains no keys.

`SIGINT` and `SIGTERM` stop HTTP admission and wait for startup and already-authorized work to finish before releasing the lock. Adapter startup failures and HTTP bind failures also release the lock acquired by that process. Release checks the file identity and will not remove a replacement lock. Normal shutdown does not cancel or recreate a private query.

A hard crash or forced termination may leave `.server.lock` behind. It is never deleted automatically based on PID existence, elapsed time or malformed contents. PID reuse makes those checks insufficient by themselves.

To reconcile a leftover lock:

1. Inspect the lock's process ID, start time and the previous server command/session path. Confirm the previous server **and any startup or authorized child work have stopped**. If it is still running, stop it gracefully and wait for its work to finish.
2. Only after that verification, explicitly remove the single `.server.lock` file from the intended session directory. Preserve `state.json`, retained plans, keys, signed journals and receipts.
3. Reopen the same session. Interrupted work still requires its normal explicit recovery; removing a stale lock is not authorization to sign, refresh a transaction or create a new query.

This exclusion protects one local Approvals session's state. It is not a distributed lock, a wallet permission or a reservation of onchain allowance. External SDK clients can still act independently, and the native settlement invariants remain necessary.

Host tests exercise two contenders, replacement/symlink/stale locks, startup and bind failures, in-flight work, and a real child Node process receiving SIGTERM. They do not claim new validator or MPC execution.
