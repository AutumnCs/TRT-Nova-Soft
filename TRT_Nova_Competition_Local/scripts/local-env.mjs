import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseEnvironment(text) {
  return Object.fromEntries(String(text).split(/\r?\n/).flatMap(line => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return [];
    const split = value.indexOf('=');
    return split > 0 ? [[value.slice(0, split).trim(), value.slice(split + 1).trim()]] : [];
  }));
}
export function readLocalEnvironment(root = projectRoot) {
  return parseEnvironment(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
}
export function validateLocalSettings(env) {
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST)) throw new Error('LOCAL_DATABASE_MUST_BE_LOOPBACK');
  if (!/^nova_competition_[a-zA-Z0-9_]{1,40}$/.test(env.DB_NAME || '')) throw new Error('LOCAL_DATABASE_REQUIRES_COMPETITION_NAME');
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(env.DB_USER || '')) throw new Error('LOCAL_DATABASE_USER_INVALID');
  for (const key of ['DB_PORT', 'LOCAL_PORT']) {
    const port = Number(env[key]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_PORT_INVALID:' + key);
  }
  if (!env.DB_PASSWORD || !env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('RUN_LOCAL_SETUP_FIRST');
  return env;
}
export function argumentsByName(args = process.argv.slice(2)) {
  return Object.fromEntries(args.map(arg => {
    const split = arg.indexOf('=');
    return split < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(0, split).replace(/^--/, ''), arg.slice(split + 1)];
  }));
}
