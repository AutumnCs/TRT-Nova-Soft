const crypto = require('crypto');

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input) {
  const normalized = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(padding), 'base64').toString('utf8');
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedBody, signature] = parts;
  const content = `${encodedHeader}.${encodedBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  if (expected !== signature) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64urlDecode(encodedBody));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) {
    throw new Error('Token expired');
  }

  return payload;
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lower) {
      return value;
    }
  }
  return '';
}

function getBearerToken(headers) {
  const authorization = String(getHeader(headers, 'authorization') || '').trim();
  if (!authorization.startsWith('Bearer ')) {
    return '';
  }
  return authorization.slice('Bearer '.length).trim();
}

function resolveJwtOpenid(headers, jwtSecret) {
  const secret = String(jwtSecret || '').trim();
  if (!secret) {
    return '';
  }

  const customAccessToken = String(
    getHeader(headers, 'x-access-token') ||
    getHeader(headers, 'xAccessToken') ||
    ''
  ).trim();

  const token = customAccessToken || getBearerToken(headers);
  if (!token) {
    return '';
  }

  const payload = verifyJwt(token, secret);
  return payload?.openid ? String(payload.openid).trim() : '';
}

function resolveAuthenticatedOpenid(options = {}) {
  const headers = options.headers || {};
  const body = options.body || {};
  const jwtSecret = options.jwtSecret || '';
  const allowLegacyOpenidFallback = Boolean(options.allowLegacyOpenidFallback);

  const authOpenid = resolveJwtOpenid(headers, jwtSecret);
  if (authOpenid) {
    return authOpenid;
  }

  if (!allowLegacyOpenidFallback) {
    throw new Error('Missing bearer token');
  }

  const legacyOpenid =
    getHeader(headers, 'x-wx-openid') ||
    getHeader(headers, 'x-openid') ||
    body?.openid ||
    '';

  if (!legacyOpenid) {
    throw new Error('Missing openid or bearer token');
  }

  return String(legacyOpenid).trim();
}

module.exports = {
  base64urlEncode,
  base64urlDecode,
  verifyJwt,
  resolveAuthenticatedOpenid
};
