const { getHeaders } = require('./http');

function base64urlDecode(input) {
  const normalized = String(input)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(padding), 'base64').toString('utf8');
}

function verifyJwt(token, secret) {
  const crypto = require('crypto');
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

function resolveAuthorizationOpenid(event, jwtSecret = process.env.JWT_SECRET || '') {
  if (!jwtSecret) return '';

  const headers = getHeaders(event);
  const customAccessToken =
    headers['x-access-token'] ||
    headers['X-ACCESS-TOKEN'] ||
    headers['xAccessToken'] ||
    '';
  if (customAccessToken) {
    const payload = verifyJwt(String(customAccessToken).trim(), jwtSecret);
    return payload?.openid ? String(payload.openid).trim() : '';
  }

  const authorization = headers.authorization || headers.Authorization || '';
  if (!authorization.startsWith('Bearer ')) return '';

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return '';

  const payload = verifyJwt(token, jwtSecret);
  return payload?.openid ? String(payload.openid).trim() : '';
}

function resolveOpenid(event, body, options = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const allowLegacyOpenidFallback = Object.prototype.hasOwnProperty.call(options, 'allowLegacyOpenidFallback')
    ? options.allowLegacyOpenidFallback === true
    : String(process.env.ALLOW_LEGACY_OPENID_FALLBACK || '').trim() === '1';
  const debugOpenid = options.debugOpenid ?? process.env.DEBUG_OPENID ?? '';
  const authOpenid = resolveAuthorizationOpenid(event, jwtSecret);
  if (authOpenid) return authOpenid;

  if (!allowLegacyOpenidFallback) {
    throw new Error('Missing bearer token');
  }

  const headers = getHeaders(event);
  const headerOpenid =
    headers['x-wx-openid'] ||
    headers['X-WX-OPENID'] ||
    headers['x-openid'] ||
    headers['X-OPENID'];

  const bodyOpenid = body?.openid || '';
  const openid = headerOpenid || bodyOpenid || debugOpenid;

  if (!openid) {
    throw new Error('Missing openid or bearer token');
  }

  return String(openid).trim();
}

module.exports = {
  resolveOpenid,
  verifyJwt
};
