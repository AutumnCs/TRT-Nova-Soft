import crypto from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const content = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !secret) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION
    }, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`${SCRYPT_PREFIX}$${salt.toString('base64')}$${derivedKey.toString('base64')}`);
    });
  });
}

function verifyPassword(password, encoded) {
  return new Promise((resolve, reject) => {
    const [prefix, saltValue, hashValue] = String(encoded || '').split('$');
    if (prefix !== SCRYPT_PREFIX || !saltValue || !hashValue) return resolve(false);
    crypto.scrypt(password, Buffer.from(saltValue, 'base64'), 64, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION
    }, (error, derivedKey) => {
      if (error) return reject(error);
      const expected = Buffer.from(hashValue, 'base64');
      resolve(expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey));
    });
  });
}

function getHeader(headers = {}, name) {
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry ? String(entry[1] || '') : '';
}

export function createAdminAuth({ repository, jwtSecret = process.env.ADMIN_JWT_SECRET || '' } = {}) {
  return {
    async login(username, password) {
      if (!jwtSecret || !repository?.findByUsername || !username || !password) return { ok: false };
      const user = await repository.findByUsername(String(username).trim());
      if (!user || user.status !== 'active' || !(await verifyPassword(password, user.passwordHash))) return { ok: false };
      const now = Math.floor(Date.now() / 1000);
      return {
        ok: true,
        token: signToken({ sub: String(user.id), username: user.username, role: user.role, iat: now, exp: now + 8 * 60 * 60 }, jwtSecret),
        admin: { id: user.id, username: user.username, role: user.role }
      };
    },

    async authenticate(event = {}) {
      const authorization = getHeader(event.headers, 'authorization');
      if (!authorization.startsWith('Bearer ')) return { ok: false };
      const payload = verifyToken(authorization.slice(7).trim(), jwtSecret);
      if (!payload?.sub || !payload.role) return { ok: false };
      return { ok: true, admin: payload };
    }
  };
}
