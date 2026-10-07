export class ServiceError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
export function requireInput(condition, message) {
  if (!condition) throw new ServiceError('INVALID_INPUT', message, 422);
}
export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
export function exactObject(value, keys) {
  requireInput(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `Expected fields: ${keys.join(', ')}.`);
}
