import { EvidenceError, publicKeyBytes, requireEvidence } from './codec.mjs';

/** Local reads only. No signer, key loading, sends, redirects or public RPC fallback. */
export class LocalRpcTransport {
  constructor(endpoint = 'http://127.0.0.1:8899', { fetch: fetcher = globalThis.fetch, commitment = 'finalized', timeoutMs = 10000 } = {}) {
    const url = new URL(endpoint);
    requireEvidence(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback RPC is supported');
    requireEvidence(!url.username && !url.password, 'RPC credentials are not supported');
    requireEvidence(['confirmed', 'finalized'].includes(commitment), 'Use confirmed or finalized commitment');
    requireEvidence(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'Invalid timeout');
    this.endpoint = url.href; this.fetch = fetcher; this.commitment = commitment; this.timeoutMs = timeoutMs;
  }
  async readAccounts(addresses, { minContextSlot } = {}) {
    requireEvidence(addresses.length > 0 && addresses.length <= 100, 'Invalid account count');
    addresses.forEach(publicKeyBytes);
    if (minContextSlot !== undefined) requireEvidence(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0, 'Invalid minimum slot');
    const config = { encoding: 'base64', commitment: this.commitment, ...(minContextSlot === undefined ? {} : { minContextSlot }) };
    const response = await this.fetch(this.endpoint, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [addresses, config] }) });
    requireEvidence(response.ok, `RPC HTTP failure ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new EvidenceError(`RPC error ${payload.error.code}: ${payload.error.message}`);
    const result = payload.result;
    requireEvidence(payload.jsonrpc === '2.0' && payload.id === 1 && Number.isSafeInteger(result?.context?.slot) && result.context.slot >= 0, 'Malformed RPC response');
    requireEvidence(minContextSlot === undefined || result.context.slot >= minContextSlot, 'RPC response predates minimum context slot');
    requireEvidence(Array.isArray(result.value) && result.value.length === addresses.length, 'Incomplete RPC account snapshot');
    const accounts = result.value.map((account, index) => {
      if (account === null) return null;
      requireEvidence(Array.isArray(account.data) && account.data.length === 2 && account.data[1] === 'base64', 'Unexpected RPC data encoding');
      publicKeyBytes(account.owner);
      requireEvidence(typeof account.executable === 'boolean' && typeof account.data[0] === 'string', 'Malformed RPC account');
      const data = Buffer.from(account.data[0], 'base64');
      requireEvidence(data.toString('base64') === account.data[0], 'Noncanonical base64 account data');
      return { address: addresses[index], owner: account.owner, executable: account.executable, data };
    });
    return { slot: result.context.slot, commitment: this.commitment, accounts };
  }
}
