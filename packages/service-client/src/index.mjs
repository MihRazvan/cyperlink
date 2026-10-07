/** Dependency-free HTTP client. No signers, witnesses or transaction submission. */
export class CyperLinkServiceError extends Error {
  constructor(code, message, { status, requestId, cause } = {}) {
    super(message, { cause });
    this.name = 'CyperLinkServiceError';
    this.code = code; this.status = status; this.requestId = requestId;
  }
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) throw new TypeError('Expected a resource identifier of 1–100 letters, digits, underscores or hyphens.');
  return value;
}

export class CyperLinkServiceClient {
  #url; #token; #timeout; #fetch;
  constructor({ endpoint, token, timeoutMs = 60_000, fetch: transport = globalThis.fetch }) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new TypeError('Expected an HTTP service origin.');
    if (url.protocol === 'http:' && url.hostname !== '127.0.0.1') throw new TypeError('Plain HTTP is only supported on 127.0.0.1.');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new TypeError('Expected a configured bearer token.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || typeof transport !== 'function') throw new TypeError('Invalid request options.');
    this.#url = url.origin; this.#token = token; this.#timeout = timeoutMs; this.#fetch = transport;
  }
  async #request(path, body, { signal } = {}) {
    const deadline = AbortSignal.timeout(this.#timeout);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response, envelope;
    try {
      response = await this.#fetch(this.#url + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      envelope = await response.json();
    } catch (cause) {
      // A lost response may follow a persisted write. Callers reconcile by the same
      // resource id; the client never retries or invents another operation.
      throw new CyperLinkServiceError(combined.aborted ? 'REQUEST_ABORTED' : 'TRANSPORT_UNRESOLVED',
        'The request outcome is unresolved. Reconcile the same resource before retrying.', { cause });
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (envelope?.apiVersion !== 'v1') throw new CyperLinkServiceError('PROTOCOL_MISMATCH', 'Unsupported service response.', { status: response.status, requestId });
    if (!response.ok) {
      if (typeof envelope.error?.code !== 'string' || typeof envelope.error?.message !== 'string') throw new CyperLinkServiceError('PROTOCOL_MISMATCH', 'Malformed service error.', { status: response.status, requestId });
      throw new CyperLinkServiceError(envelope.error.code, envelope.error.message, { status: response.status, requestId });
    }
    if (!Object.hasOwn(envelope, 'data')) throw new CyperLinkServiceError('PROTOCOL_MISMATCH', 'Missing service result.', { status: response.status, requestId });
    return envelope.data;
  }
  listProjects(options) { return this.#request('/v1/projects', undefined, options); }
  registerProject({ id, source }, options) { return this.#request('/v1/projects', { id: identifier(id), source: identifier(source) }, options); }
  getProject(project, options) { return this.#request(`/v1/projects/${identifier(project)}`, undefined, options); }
  listOperations(project, options) { return this.#request(`/v1/projects/${identifier(project)}/operations`, undefined, options); }
  importOperation(project, { id, reference }, options) { return this.#request(`/v1/projects/${identifier(project)}/operations`, { id: identifier(id), reference: identifier(reference) }, options); }
  getOperation(project, operation, options) { return this.#request(`/v1/projects/${identifier(project)}/operations/${identifier(operation)}`, undefined, options); }
  observe(project, operation, options) { return this.#request(`/v1/projects/${identifier(project)}/operations/${identifier(operation)}/observe`, {}, options); }
  recover(project, operation, role, options) {
    if (!['query', 'commit'].includes(role)) throw new TypeError('Recovery role must be query or commit.');
    return this.#request(`/v1/projects/${identifier(project)}/operations/${identifier(operation)}/recover`, { role }, options);
  }
}
