const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENETDOWN', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const ABORT_NAMES = new Set(['AbortError', 'TimeoutError']);

function safeMethod(method) {
  return typeof method === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(method) ? method : null;
}

function requestMethod(options) {
  if (typeof options?.body !== 'string') return null;
  let request;
  try { request = JSON.parse(options.body); }
  catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return !Array.isArray(request) ? safeMethod(request?.method) : null;
}

/** Availability metadata only: never retain URLs, request/response bodies or causes. */
export class RpcUnavailableError extends Error {
  constructor({ method = null, category, status, code } = {}) {
    super('RPC unavailable');
    if (!['network', 'http'].includes(category)
      || (status !== undefined && (category !== 'http' || !TRANSIENT_HTTP_STATUSES.has(status)))
      || (code !== undefined && (category !== 'network' || (!NETWORK_CODES.has(code) && !ABORT_NAMES.has(code))))) {
      throw new TypeError('Invalid RPC availability metadata');
    }
    this.name = 'RpcUnavailableError';
    this.method = safeMethod(method);
    this.category = category;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export function isRpcUnavailable(error, expectedMethod) {
  return error instanceof RpcUnavailableError
    && (expectedMethod === undefined || error.method === expectedMethod);
}

/** Wrap only fetch availability failures; callers retain all response decoding. */
export async function fetchRpc(fetchImpl, url, options) {
  const method = requestMethod(options);
  let response;
  try { response = await fetchImpl(url, options); }
  catch (error) {
    const code = error instanceof Error && ABORT_NAMES.has(error.name) ? error.name
      : error instanceof TypeError && NETWORK_CODES.has(error.cause?.code) ? error.cause.code : undefined;
    if (code !== undefined) throw new RpcUnavailableError({ method, category: 'network', code });
    throw error;
  }
  if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
    throw new RpcUnavailableError({ method, category: 'http', status: response.status });
  }
  return response;
}
