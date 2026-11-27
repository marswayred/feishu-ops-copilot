import crypto from 'node:crypto';

// 标准化权限范围：对外只读清单不需要写权限。
export const API_SCOPES = Object.freeze(['projects:read', 'projects:write', 'directory:read', 'tasks:read']);
export const READONLY_SCOPES = Object.freeze(['projects:read']);

const TOKEN_PREFIX = 'opsk_';
const TOKEN_RANDOM_BYTES = 32;

export function generateApiToken() {
  const secret = crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  return `${TOKEN_PREFIX}${secret}`;
}

export function hashApiToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenDisplayPrefix(token) {
  return `${token.slice(0, TOKEN_PREFIX.length + 4)}…${token.slice(-4)}`;
}

export function normalizeScopes(input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  const unique = [...new Set(input.filter(scope => API_SCOPES.includes(scope)))];
  return unique.sort((a, b) => API_SCOPES.indexOf(a) - API_SCOPES.indexOf(b));
}

export function tokenIsUsable(token, now = Date.now()) {
  if (!token) return false;
  if (token.revokedAt) return false;
  if (token.expiresAt) {
    const expires = Date.parse(token.expiresAt);
    if (!Number.isFinite(expires) || expires <= now) return false;
  }
  return true;
}

export function tokenHasScope(token, scope) {
  return Array.isArray(token?.scopes) && token.scopes.includes(scope);
}
